import { Router, Response } from "express";
import { AppDataSource } from "../config/database";
import { Request as SystemRequest } from "../entities/Request";
import { Livro } from "../entities/Livro";
import { User } from "../entities/User";
import { AuthRequest, authMiddleware, requireRole } from "../middlewares/auth";
import { getImageUrl, saveImage, deleteImage, UNSUPPORTED_IMAGE_MESSAGE } from "../utils/image";
import { searchBooks, downloadCoverToUploads } from "../services/bookLookup";
import { syncAuthorsForBook } from "../services/authorService";
import multer from "multer";
import * as path from "path";

export const editorRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

editorRouter.use(authMiddleware());
editorRouter.use(requireRole("editor"));

// Pricing helper
const parsePreco = (value: any): string | null => {
  if (value === undefined || value === null) return "0.00";
  const raw = String(value).trim().replace(",", ".");
  if (!raw) return "0.00";
  const num = parseFloat(raw);
  if (isNaN(num) || num < 0) return null;
  return num.toFixed(2);
};

editorRouter.get("/requests", async (req: AuthRequest, res: Response) => {
  const editor_id = req.user!.id;
  const requestRepository = AppDataSource.getRepository(SystemRequest);

  try {
    const rows = await requestRepository.find({
      where: { editor_id },
      relations: ["leitor", "livro"],
      order: { data_criacao: "DESC" },
    });

    return res.status(200).json(
      rows.map((r) => ({
        id: r.id,
        leitor_id: r.leitor_id,
        leitor_nome: r.leitor ? r.leitor.nome : `Leitor #${r.leitor_id}`,
        livro_id: r.livro_id,
        livro_titulo: r.livro ? r.livro.titulo : null,
        livro_autor: r.livro ? r.livro.autor : null,
        livro_imagem_url: r.livro ? getImageUrl(req, r.livro.imagem) : null,
        conteudo: r.conteudo,
        resposta: r.resposta,
        status: r.status,
        data_criacao: r.data_criacao ? r.data_criacao.toISOString() : null,
      }))
    );
  } catch (err) {
    console.error("Error listing editor requests:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

editorRouter.put("/requests/:id/respond", async (req: AuthRequest, res: Response) => {
  const editor_id = req.user!.id;
  const requestId = parseInt(req.params.id);
  const { resposta } = req.body || {};

  if (!resposta || !String(resposta).trim()) {
    return res.status(400).json({ message: "resposta é obrigatória" });
  }

  const requestRepository = AppDataSource.getRepository(SystemRequest);

  try {
    const solicitacao = await requestRepository.findOneBy({ id: requestId, editor_id });
    if (!solicitacao) {
      return res.status(404).json({ message: "Solicitação não encontrada para esta editora" });
    }

    if (solicitacao.status === "respondida") {
      return res.status(400).json({ message: "Solicitação já respondida" });
    }

    solicitacao.resposta = resposta;
    solicitacao.status = "respondida";

    await requestRepository.save(solicitacao);

    return res.status(200).json({ message: "Solicitação respondida com sucesso" });
  } catch (err) {
    console.error("Error responding to request:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

editorRouter.get("/books/lookup", async (req: AuthRequest, res: Response) => {
  const q = String(req.query.q || "").trim();
  const limit = parseInt(String(req.query.limit || "8")) || 8;

  if (q.length < 2) {
    return res.status(400).json({
      message: "Informe ao menos 2 caracteres para buscar.",
      items: [],
    });
  }

  try {
    const items = await searchBooks(q, limit);
    return res.status(200).json({ items, fonte: "open_library" });
  } catch (err) {
    return res.status(503).json({
      message: "Serviço de busca temporariamente indisponível.",
      items: [],
    });
  }
});

editorRouter.get("/books", async (req: AuthRequest, res: Response) => {
  const editor_id = req.user!.id;
  const page = parseInt(String(req.query.page || "1")) || 1;
  const perPage = parseInt(String(req.query.per_page || "10")) || 10;
  const q = String(req.query.q || "");
  const genero = String(req.query.genero || "");

  const libroRepository = AppDataSource.getRepository(Livro);

  try {
    const queryBuilder = libroRepository.createQueryBuilder("livro")
      .where("livro.editor_id = :editor_id", { editor_id });

    if (q) {
      queryBuilder.andWhere(
        "(livro.titulo ILIKE :q OR livro.autor ILIKE :q)",
        { q: `%${q}%` }
      );
    }

    if (genero) {
      queryBuilder.andWhere("livro.genero = :genero", { genero });
    }

    queryBuilder.orderBy("livro.data_cadastro", "DESC");

    const total = await queryBuilder.getCount();
    const items = await queryBuilder
      .skip((page - 1) * perPage)
      .take(perPage)
      .getMany();

    const pages = Math.ceil(total / perPage);

    return res.status(200).json({
      items: items.map((b) => ({
        id: b.id,
        titulo: b.titulo,
        autor: b.autor,
        genero: b.genero,
        condicao: b.condicao || "novo",
        preco: b.preco,
        estoque: b.estoque,
        paginas: b.paginas,
        descricao: b.descricao,
        imagem: b.imagem,
        imagem_url: getImageUrl(req, b.imagem),
        data_cadastro: b.data_cadastro ? b.data_cadastro.toISOString() : null,
      })),
      total,
      page,
      pages,
    });
  } catch (err) {
    console.error("Error listing editor books:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

editorRouter.post("/books", upload.single("imagem"), async (req: AuthRequest, res: Response) => {
  const editor_id = req.user!.id;
  const { titulo, autor, preco: rawPreco, genero, condicao, descricao, open_library_cover_id, paginas, author_nationality } = req.body || {};

  const estoque = parseInt(req.body.estoque || "0") || 0;
  const paginasInt = parseInt(req.body.paginas || "0") || 0;

  if (estoque < 0) {
    return res.status(400).json({ message: "estoque deve ser maior ou igual a zero" });
  }

  const preco = parsePreco(rawPreco);
  if (preco === null) {
    return res.status(400).json({ message: "Preço inválido" });
  }
  if (!titulo || !autor) {
    return res.status(400).json({ message: "Título e autor são obrigatórios" });
  }

  const libroRepository = AppDataSource.getRepository(Livro);

  try {
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
    novoLivro.editor_id = editor_id;
    novoLivro.titulo = titulo;
    novoLivro.autor = autor;
    novoLivro.preco = preco;
    novoLivro.estoque = estoque;
    novoLivro.paginas = paginasInt;
    novoLivro.genero = genero || null;
    novoLivro.condicao = condicao || "novo";
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
    // Mimic the Flask exception logic which catches DataError / IntegrityError as 400
    if ((err as any).name === "QueryFailedError") {
      return res.status(400).json({ message: "Dados inválidos" });
    }
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

editorRouter.put("/books/:id", upload.single("imagem"), async (req: AuthRequest, res: Response) => {
  const editor_id = req.user!.id;
  const bookId = parseInt(req.params.id);

  const libroRepository = AppDataSource.getRepository(Livro);

  try {
    const livro = await libroRepository.findOneBy({ id: bookId, editor_id });
    if (!livro) {
      return res.status(404).json({ message: "Livro não encontrado" });
    }

    const body = req.body || {};

    if ("titulo" in body) livro.titulo = body.titulo;
    if ("autor" in body) livro.autor = body.autor;
    if ("genero" in body) livro.genero = body.genero;
    if ("condicao" in body) livro.condicao = body.condicao || "novo";
    if ("descricao" in body) livro.descricao = body.descricao;
    if ("paginas" in body) {
      const paginasInt = parseInt(body.paginas);
      livro.paginas = isNaN(paginasInt) ? 0 : paginasInt;
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

editorRouter.delete("/books/:id", async (req: AuthRequest, res: Response) => {
  const editor_id = req.user!.id;
  const bookId = parseInt(req.params.id);

  const libroRepository = AppDataSource.getRepository(Livro);

  try {
    const livro = await libroRepository.findOneBy({ id: bookId, editor_id });
    if (!livro) {
      return res.status(404).json({ message: "Livro não encontrado" });
    }

    // Just zero the stock as in Python delete logic
    livro.estoque = 0;
    await libroRepository.save(livro);

    return res.status(200).json({
      message: "Livro removido do catálogo de vendas (estoque zerado)",
    });
  } catch (err) {
    console.error("Error deleting book:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});
