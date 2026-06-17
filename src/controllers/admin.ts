import { Router, Response } from "express";
import { AppDataSource } from "../config/database";
import { User } from "../entities/User";
import { Livro } from "../entities/Livro";
import { Request as SystemRequest } from "../entities/Request";
import { AuthRequest, authMiddleware, requireRole } from "../middlewares/auth";
import { deleteImage } from "../utils/image";
import * as bcrypt from "bcryptjs";

export const adminRouter = Router();

// Apply auth middleware to all admin routes
adminRouter.use(authMiddleware());
adminRouter.use(requireRole("admin"));

adminRouter.get("/users", async (req: AuthRequest, res: Response) => {
  const userRepository = AppDataSource.getRepository(User);
  try {
    const users = await userRepository.find({
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

  try {
    const userExists = await userRepository.findOneBy({ email });
    if (userExists) {
      return res.status(400).json({ message: "Email já cadastrado" });
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

    // Get editor info for each book
    const booksWithEditor = await Promise.all(
      books.map(async (b) => {
        const editor = await userRepository.findOneBy({ id: b.editor_id });
        return {
          id: b.id,
          titulo: b.titulo,
          autor: b.autor,
          editor_nome: editor?.nome || "Desconhecido",
          editor_id: b.editor_id,
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
