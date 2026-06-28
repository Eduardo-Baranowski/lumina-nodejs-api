import { Router, Response } from "express";
import { AppDataSource } from "../config/database";
import { User } from "../entities/User";
import { Livro } from "../entities/Livro";
import { Request as SystemRequest } from "../entities/Request";
import { AuthRequest, authMiddleware, requireRole } from "../middlewares/auth";
import { getImageUrl, saveImage, deleteImage, UNSUPPORTED_IMAGE_MESSAGE } from "../utils/image";
import { searchBooks, downloadCoverToUploads } from "../services/bookLookup";
import { syncAuthorsForBook } from "../services/authorService";
import * as bcrypt from "bcryptjs";
import { Editora } from "../entities/Editora";
import multer from "multer";
import * as path from "path";

export const adminRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

const parsePreco = (value: any): string | null => {
  if (value === undefined || value === null) return "0.00";
  const raw = String(value).trim().replace(",", ".");
  if (!raw) return "0.00";
  const num = parseFloat(raw);
  if (isNaN(num) || num < 0) return null;
  return num.toFixed(2);
};

// Apply auth middleware to all admin routes
adminRouter.use(authMiddleware());
adminRouter.use(requireRole("admin"));

adminRouter.get("/users", async (req: AuthRequest, res: Response) => {
  const userRepository = AppDataSource.getRepository(User);
  try {
    const search = req.query.search ? String(req.query.search) : "";
    const whereClause = search
      ? [
          { nome: require("typeorm").ILike(`%${search}%`) },
          { email: require("typeorm").ILike(`%${search}%`) }
        ]
      : {};

    const users = await userRepository.find({
      where: whereClause,
      order: { id: "ASC" },
    });

    return res.status(200).json(
      users.map((u) => ({
        id: u.id,
        nome: u.nome,
        email: u.email,
        papel: u.papel,
      }))
    );
  } catch (err) {
    console.error("Error listing users:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

adminRouter.post("/users", async (req: AuthRequest, res: Response) => {
  const { nome, email, senha, papel } = req.body || {};

  if (!["editor", "leitor", "admin"].includes(papel)) {
    return res.status(400).json({ message: "Papel de usuário inválido" });
  }

  if (!nome || !email || !senha) {
    return res.status(400).json({
      message: "Campos nome, email e senha são obrigatórios",
    });
  }

  const userRepository = AppDataSource.getRepository(User);
  const editoraRepository = AppDataSource.getRepository(Editora);

  try {
    const userExists = await userRepository.findOneBy({ email });
    if (userExists) {
      return res.status(400).json({ message: "Email já cadastrado" });
    }

    if (papel === "editor") {
      const editoraExists = await editoraRepository.findOne({ where: { nome } });
      if (editoraExists) {
        return res.status(400).json({ message: "Já existe uma Editora com este nome" });
      }
    }

    const salt = bcrypt.genSaltSync(10);
    const senha_hash = bcrypt.hashSync(senha, salt);

    const newUser = new User();
    newUser.nome = nome;
    newUser.email = email;
    newUser.senha_hash = senha_hash;
    newUser.papel = papel;

    await userRepository.save(newUser);

    return res.status(201).json({
      message: "Usuário criado com sucesso",
      id: newUser.id,
    });
  } catch (err) {
    console.error("Error creating user:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});
adminRouter.delete("/users/:id", async (req: AuthRequest, res: Response) => {
  const userId = parseInt(req.params.id);
  const userRepository = AppDataSource.getRepository(User);

  try {
    const user = await userRepository.findOneBy({ id: userId });
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    await AppDataSource.manager.transaction(async (transactionalEntityManager) => {
      // 1. Social & Messages
      await transactionalEntityManager.query('DELETE FROM "friendship" WHERE requester_id = $1 OR addressee_id = $1', [userId]);
      await transactionalEntityManager.query('DELETE FROM "follow" WHERE follower_id = $1 OR following_id = $1', [userId]);
      await transactionalEntityManager.query('DELETE FROM "message" WHERE sender_id = $1 OR receiver_id = $1', [userId]);
      
      // 2. Book Clubs
      await transactionalEntityManager.query('DELETE FROM "book_club_vote" WHERE nomination_id IN (SELECT id FROM "book_club_nomination" WHERE user_id = $1)', [userId]);
      await transactionalEntityManager.query('DELETE FROM "book_club_vote" WHERE user_id = $1', [userId]);
      await transactionalEntityManager.query('DELETE FROM "book_club_nomination" WHERE user_id = $1', [userId]);
      await transactionalEntityManager.query('DELETE FROM "book_club_member" WHERE user_id = $1', [userId]);
      
      // If user owns a club, destroy the club and its dependencies
      const userClubs = await transactionalEntityManager.query('SELECT id FROM "book_club" WHERE criado_por_id = $1', [userId]);
      for (const c of userClubs) {
         const clubId = c.id;
         await transactionalEntityManager.query('DELETE FROM "book_club_vote" WHERE cycle_id IN (SELECT id FROM "book_club_cycle" WHERE book_club_id = $1)', [clubId]);
         await transactionalEntityManager.query('UPDATE "book_club_cycle" SET "nomination_vencedora_id" = NULL WHERE book_club_id = $1', [clubId]);
         await transactionalEntityManager.query('DELETE FROM "book_club_nomination" WHERE cycle_id IN (SELECT id FROM "book_club_cycle" WHERE book_club_id = $1)', [clubId]);
         await transactionalEntityManager.query('DELETE FROM "book_club_cycle" WHERE book_club_id = $1', [clubId]);
         await transactionalEntityManager.query('DELETE FROM "book_club_member" WHERE club_id = $1', [clubId]);
         await transactionalEntityManager.query('DELETE FROM "book_club" WHERE id = $1', [clubId]);
      }

      // 3. Interactions (Feed, Leitura)
      await transactionalEntityManager.query('DELETE FROM "feed_like" WHERE user_id = $1', [userId]);
      await transactionalEntityManager.query('DELETE FROM "feed_comment" WHERE user_id = $1', [userId]);

      // 4. Pedidos & Compras
      await transactionalEntityManager.query('DELETE FROM "item_pedido" WHERE pedido_id IN (SELECT id FROM "pedido" WHERE leitor_id = $1)', [userId]);
      await transactionalEntityManager.query('DELETE FROM "pedido" WHERE leitor_id = $1', [userId]);
      await transactionalEntityManager.query('DELETE FROM "compra" WHERE leitor_id = $1', [userId]);

      // 5. Books (if user is editor, delete all published books and dependencies)
      const livros = await transactionalEntityManager.query('SELECT id FROM "livro" WHERE editor_id = $1', [userId]);
      for (const row of livros) {
        const bookId = row.id;
        await transactionalEntityManager.query('UPDATE "request" SET "livro_id" = NULL WHERE "livro_id" = $1', [bookId]);
        await transactionalEntityManager.query('UPDATE "book_club_nomination" SET "livro_id" = NULL WHERE "livro_id" = $1', [bookId]);
        await transactionalEntityManager.query('DELETE FROM "item_pedido" WHERE "livro_id" = $1', [bookId]);
        await transactionalEntityManager.query('DELETE FROM "compra" WHERE "livro_id" = $1', [bookId]);
        await transactionalEntityManager.query(`DELETE FROM "feed_like" WHERE "leitura_id" IN (SELECT "id" FROM "leitura" WHERE "livro_id" = $1)`, [bookId]);
        await transactionalEntityManager.query(`DELETE FROM "feed_comment" WHERE "leitura_id" IN (SELECT "id" FROM "leitura" WHERE "livro_id" = $1)`, [bookId]);
        await transactionalEntityManager.query('DELETE FROM "leitura" WHERE "livro_id" = $1', [bookId]);
        await transactionalEntityManager.query('DELETE FROM "livro" WHERE "id" = $1', [bookId]);
      }

      // 6. Delete remaining leituras, requests, endereços
      await transactionalEntityManager.query('DELETE FROM "feed_like" WHERE "leitura_id" IN (SELECT "id" FROM "leitura" WHERE "leitor_id" = $1)', [userId]);
      await transactionalEntityManager.query('DELETE FROM "feed_comment" WHERE "leitura_id" IN (SELECT "id" FROM "leitura" WHERE "leitor_id" = $1)', [userId]);
      await transactionalEntityManager.query('DELETE FROM "leitura" WHERE leitor_id = $1', [userId]);
      await transactionalEntityManager.query('DELETE FROM "request" WHERE leitor_id = $1 OR editor_id = $1', [userId]);
      await transactionalEntityManager.query('DELETE FROM "endereco" WHERE user_id = $1', [userId]);

      // 7. Finally remove the user
      await transactionalEntityManager.remove(user);
    });

    return res.status(200).json({ message: "Usuário excluído com sucesso" });
  } catch (err) {
    console.error("Error deleting user:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

adminRouter.get("/editoras", async (req: AuthRequest, res: Response) => {
  const editoraRepository = AppDataSource.getRepository(Editora);
  try {
    const search = req.query.search ? String(req.query.search) : "";
    const whereClause = search
      ? [{ nome: require("typeorm").ILike(`%${search}%`) }]
      : {};

    const editoras = await editoraRepository.find({
      where: whereClause,
      order: { nome: "ASC" },
    });

    return res.status(200).json(
      editoras.map((e) => ({
        id: e.id,
        nome: e.nome,
        imagem_url: getImageUrl(req, e.imagem),
        criado_em: e.criado_em.toISOString(),
      }))
    );
  } catch (err) {
    console.error("Error listing editoras:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

adminRouter.post("/editoras", upload.single("imagem"), async (req: AuthRequest, res: Response) => {
  const { nome } = req.body;
  if (!nome || !nome.trim()) {
    return res.status(400).json({ message: "Nome da editora é obrigatório" });
  }

  const editoraRepository = AppDataSource.getRepository(Editora);
  const userRepository = AppDataSource.getRepository(User);

  try {
    // Verificar conflito com editoras existentes
    const editoraExists = await editoraRepository.findOneBy({ nome: nome.trim() });
    if (editoraExists) {
      return res.status(400).json({ message: "Já existe uma Editora com este nome" });
    }

    // Verificar conflito com usuários que são editores
    const userExists = await userRepository.findOneBy({ nome: nome.trim(), papel: "editor" });
    if (userExists) {
      return res.status(400).json({ message: "Já existe um usuário Editor com este nome" });
    }

    let imagem_path: string | null = null;
    if (req.file) {
      imagem_path = await saveImage(req.file, "editoras");
      if (!imagem_path) {
        return res.status(400).json({ message: UNSUPPORTED_IMAGE_MESSAGE });
      }
    }

    const novaEditora = new Editora();
    novaEditora.nome = nome.trim();
    novaEditora.imagem = imagem_path;

    await editoraRepository.save(novaEditora);

    return res.status(201).json({
      message: "Editora cadastrada com sucesso",
      id: novaEditora.id,
    });
  } catch (err) {
    console.error("Error creating editora:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

adminRouter.post("/books", upload.single("imagem"), async (req: AuthRequest, res: Response) => {
  const { editora_id, titulo, autor, genero, descricao, open_library_cover_id, paginas, author_nationality } = req.body || {};

  if (!editora_id) {
    return res.status(400).json({ message: "A editora é obrigatória" });
  }
  if (!titulo || !autor) {
    return res.status(400).json({ message: "Título e autor são obrigatórios" });
  }

  const editoraInt = parseInt(editora_id);
  const paginasInt = parseInt(paginas || "0") || 0;

  const editoraRepository = AppDataSource.getRepository(Editora);
  const libroRepository = AppDataSource.getRepository(Livro);

  try {
    const editoraExists = await editoraRepository.findOneBy({ id: editoraInt });
    if (!editoraExists) {
      return res.status(404).json({ message: "Editora não encontrada" });
    }

    let imagem_path: string | null = null;
    if (req.file) {
      imagem_path = await saveImage(req.file, "books");
      if (!imagem_path) {
        return res.status(400).json({ message: UNSUPPORTED_IMAGE_MESSAGE });
      }
    } else if (open_library_cover_id) {
      const coverIdInt = parseInt(open_library_cover_id);
      if (!isNaN(coverIdInt)) {
        const uploadRoot = path.join(__dirname, "../../static/uploads");
        imagem_path = await downloadCoverToUploads(coverIdInt, uploadRoot);
      }
    }

    const novoLivro = new Livro();
    novoLivro.editor_id = null;
    novoLivro.editora_id = editoraInt;
    novoLivro.titulo = titulo;
    novoLivro.autor = autor;
    novoLivro.preco = "0.00";
    novoLivro.estoque = 0;
    novoLivro.paginas = paginasInt;
    novoLivro.genero = genero || null;
    novoLivro.condicao = "novo";
    novoLivro.descricao = descricao || null;
    novoLivro.imagem = imagem_path;

    await libroRepository.save(novoLivro);
      await syncAuthorsForBook(novoLivro.id, novoLivro.autor, undefined, author_nationality ? String(author_nationality).trim() : null);

    return res.status(201).json({
      message: "Livro cadastrado com sucesso",
      id: novoLivro.id,
    });
  } catch (err) {
    console.error("Error creating book:", err);
    if ((err as any).name === "QueryFailedError") {
      return res.status(400).json({ message: "Dados inválidos" });
    }
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

adminRouter.get("/reports", async (req: AuthRequest, res: Response) => {
  const userRepository = AppDataSource.getRepository(User);
  const libroRepository = AppDataSource.getRepository(Livro);
  const requestRepository = AppDataSource.getRepository(SystemRequest);

  try {
    const total_usuarios = await userRepository.count();
    const total_livros = await libroRepository.count();

    // Group users by role
    const usersByPapel = await userRepository
      .createQueryBuilder("user")
      .select("user.papel", "papel")
      .addSelect("COUNT(user.id)", "count")
      .groupBy("user.papel")
      .getRawMany();

    // Group requests by status
    const requestsByStatus = await requestRepository
      .createQueryBuilder("request")
      .select("request.status", "status")
      .addSelect("COUNT(request.id)", "count")
      .groupBy("request.status")
      .getRawMany();

    const usuarios: Record<string, number> = {};
    usersByPapel.forEach((row) => {
      usuarios[row.papel] = parseInt(row.count);
    });

    const solicitacoes: Record<string, number> = {};
    requestsByStatus.forEach((row) => {
      solicitacoes[row.status] = parseInt(row.count);
    });

    return res.status(200).json({
      total_usuarios,
      total_livros,
      usuarios,
      solicitacoes,
    });
  } catch (err) {
    console.error("Error generating reports:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

adminRouter.get("/export-csv", async (req: AuthRequest, res: Response) => {
  const userRepository = AppDataSource.getRepository(User);
  try {
    const users = await userRepository.find({
      order: { id: "ASC" },
    });

    let csvContent = "ID,Nome,Email,Papel\n";
    users.forEach((u) => {
      // Escape quotes and wrap values in quotes if they contain commas/newlines
      const nameEscaped = `"${u.nome.replace(/"/g, '""')}"`;
      const emailEscaped = `"${u.email.replace(/"/g, '""')}"`;
      csvContent += `${u.id},${nameEscaped},${emailEscaped},${u.papel}\n`;
    });

    res.setHeader("Content-Disposition", "attachment; filename=usuarios_lumina.csv");
    res.setHeader("Content-Type", "text/csv");
    return res.status(200).send(csvContent);
  } catch (err) {
    console.error("Error exporting CSV:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// LIST ALL BOOKS (for moderation)
adminRouter.get("/books", async (req: AuthRequest, res: Response) => {
  const libroRepository = AppDataSource.getRepository(Livro);
  const userRepository = AppDataSource.getRepository(User);
  const page = parseInt(String(req.query.page || "1")) || 1;
  const search = req.query.search ? String(req.query.search) : "";
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    const whereClause = search
      ? [
          { titulo: require("typeorm").ILike(`%${search}%`) },
          { autor: require("typeorm").ILike(`%${search}%`) }
        ]
      : {};

    const [books, total] = await libroRepository.findAndCount({
      where: whereClause,
      skip: offset,
      take: limit,
      order: { id: "DESC" },
    });

    const editoraRepository = AppDataSource.getRepository(Editora);
    const booksWithEditor = await Promise.all(
      books.map(async (b) => {
        let editorNome = "Desconhecido";
        if (b.editor_id) {
          const editor = await userRepository.findOneBy({ id: b.editor_id });
          if (editor) editorNome = editor.nome;
        } else if (b.editora_id) {
          const editora = await editoraRepository.findOneBy({ id: b.editora_id });
          if (editora) editorNome = editora.nome;
        }

        return {
          id: b.id,
          titulo: b.titulo,
          autor: b.autor,
          editor_nome: editorNome,
          editor_id: b.editor_id,
          editora_id: b.editora_id,
          preco: b.preco,
          estoque: b.estoque,
          genero: b.genero,
          data_cadastro: b.data_cadastro ? b.data_cadastro.toISOString() : null,
        };
      })
    );

    return res.status(200).json({
      items: booksWithEditor,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Error listing books for admin:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// GET BOOK DETAILS (for editing)
adminRouter.get("/books/:id", async (req: AuthRequest, res: Response) => {
  const bookId = parseInt(req.params.id);
  const libroRepository = AppDataSource.getRepository(Livro);
  const userRepository = AppDataSource.getRepository(User);
  const editoraRepository = AppDataSource.getRepository(Editora);

  try {
    const book = await libroRepository.findOneBy({ id: bookId });
    if (!book) {
      return res.status(404).json({ message: "Livro não encontrado" });
    }

    let editorNome = "Desconhecido";
    if (book.editor_id) {
      const editor = await userRepository.findOneBy({ id: book.editor_id });
      if (editor) editorNome = editor.nome;
    } else if (book.editora_id) {
      const editora = await editoraRepository.findOneBy({ id: book.editora_id });
      if (editora) editorNome = editora.nome;
    }

    return res.status(200).json({
      id: book.id,
      titulo: book.titulo,
      autor: book.autor,
      editor_nome: editorNome,
      editor_id: book.editor_id,
      editora_id: book.editora_id,
      preco: book.preco,
      estoque: book.estoque,
      genero: book.genero,
      descricao: book.descricao,
      paginas: book.paginas,
      imagem_url: getImageUrl(req, book.imagem),
    });
  } catch (err) {
    console.error("Error fetching book for admin:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// UPDATE BOOK
adminRouter.put("/books/:id", upload.single("imagem"), async (req: AuthRequest, res: Response) => {
  const bookId = parseInt(req.params.id);
  const libroRepository = AppDataSource.getRepository(Livro);
  const editoraRepository = AppDataSource.getRepository(Editora);

  try {
    const livro = await libroRepository.findOneBy({ id: bookId });
    if (!livro) {
      return res.status(404).json({ message: "Livro não encontrado" });
    }

    const body = req.body || {};

    if ("titulo" in body) livro.titulo = body.titulo;
    if ("autor" in body) livro.autor = body.autor;
    if ("genero" in body) livro.genero = body.genero;
    if ("descricao" in body) livro.descricao = body.descricao;
    if ("paginas" in body) {
      const paginasInt = parseInt(body.paginas);
      livro.paginas = isNaN(paginasInt) ? 0 : paginasInt;
    }

    if ("editora_id" in body) {
      const editoraInt = parseInt(body.editora_id);
      if (isNaN(editoraInt)) {
        return res.status(400).json({ message: "editora inválida" });
      }
      const editoraExists = await editoraRepository.findOneBy({ id: editoraInt });
      if (!editoraExists) {
        return res.status(404).json({ message: "Editora não encontrada" });
      }
      livro.editora_id = editoraInt;
      livro.editor_id = null;
    }

    if ("preco" in body) {
      const preco = parsePreco(body.preco);
      if (preco === null) {
        return res.status(400).json({ message: "preço inválido" });
      }
      livro.preco = preco;
    }

    if ("estoque" in body) {
      const estoque = parseInt(body.estoque);
      if (isNaN(estoque)) {
        return res.status(400).json({ message: "estoque inválido" });
      }
      if (estoque < 0) {
        return res.status(400).json({ message: "estoque deve ser maior ou igual a zero" });
      }
      livro.estoque = estoque;
    }

    if (req.file) {
      const saved = await saveImage(req.file, "books");
      if (!saved) {
        return res.status(400).json({ message: UNSUPPORTED_IMAGE_MESSAGE });
      }
      if (livro.imagem) {
        deleteImage(livro.imagem);
      }
      livro.imagem = saved;
    } else if (body.open_library_cover_id) {
      const coverIdInt = parseInt(body.open_library_cover_id);
      if (!isNaN(coverIdInt)) {
        const uploadRoot = path.join(__dirname, "../../static/uploads");
        const newPath = await downloadCoverToUploads(coverIdInt, uploadRoot);
        if (newPath) {
          if (livro.imagem) {
            deleteImage(livro.imagem);
          }
          livro.imagem = newPath;
        }
      }
    }

    await libroRepository.save(livro);
    if ("autor" in body) {
      await syncAuthorsForBook(livro.id, livro.autor, undefined, body.author_nationality ? String(body.author_nationality).trim() : null);
    }

    return res.status(200).json({ message: "Livro atualizado com sucesso" });
  } catch (err) {
    console.error("Error updating book:", err);
    if ((err as any).name === "QueryFailedError") {
      return res.status(400).json({ message: "Dados inválidos" });
    }
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// DELETE BOOK (permanent removal)
adminRouter.delete("/books/:id", async (req: AuthRequest, res: Response) => {
  const bookId = parseInt(req.params.id);

  const libroRepository = AppDataSource.getRepository(Livro);

  try {
    const book = await libroRepository.findOneBy({ id: bookId });
    if (!book) {
      return res.status(404).json({ message: "Livro não encontrado" });
    }

    // Delete associated image file
    if (book.imagem) {
      deleteImage(book.imagem);
    }

    // Remove related records first to avoid foreign key constraint violations
    await AppDataSource.manager.transaction(async (transactionalEntityManager) => {
      // Set nullable foreign keys to NULL
      await transactionalEntityManager.query('UPDATE "request" SET "livro_id" = NULL WHERE "livro_id" = $1', [bookId]);
      await transactionalEntityManager.query('UPDATE "book_club_nomination" SET "livro_id" = NULL WHERE "livro_id" = $1', [bookId]);

      // Delete dependent records
      await transactionalEntityManager.query('DELETE FROM "item_pedido" WHERE "livro_id" = $1', [bookId]);
      await transactionalEntityManager.query('DELETE FROM "compra" WHERE "livro_id" = $1', [bookId]);

      // Leitura has dependencies in feed_like and feed_comment
      await transactionalEntityManager.query(`
        DELETE FROM "feed_like" 
        WHERE "leitura_id" IN (SELECT "id" FROM "leitura" WHERE "livro_id" = $1)
      `, [bookId]);
      await transactionalEntityManager.query(`
        DELETE FROM "feed_comment" 
        WHERE "leitura_id" IN (SELECT "id" FROM "leitura" WHERE "livro_id" = $1)
      `, [bookId]);
      await transactionalEntityManager.query('DELETE FROM "leitura" WHERE "livro_id" = $1', [bookId]);

      // Finally remove the book
      await transactionalEntityManager.remove(book);
    });

    return res.status(200).json({
      message: `Livro "${book.titulo}" removido permanentemente do sistema`,
    });
  } catch (err) {
    console.error("Error deleting book:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

adminRouter.post("/refresh-metrics", async (req: AuthRequest, res: Response) => {
  return res.status(200).json({
    message: "Métricas do sistema sincronizadas com sucesso!",
  });
});
