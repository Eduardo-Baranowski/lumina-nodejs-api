import { Router, Response, Request } from "express";
import { AppDataSource } from "../config/database";
import { User } from "../entities/User";
import { Livro } from "../entities/Livro";
import { Leitura } from "../entities/Leitura";
import { Compra } from "../entities/Compra";
import { Follow } from "../entities/Follow";
import { Friendship } from "../entities/Friendship";
import { Message } from "../entities/Message";
import { Pedido } from "../entities/Pedido";
import { ItemPedido } from "../entities/ItemPedido";
import { FeedLike } from "../entities/FeedLike";
import { FeedComment } from "../entities/FeedComment";
import { Endereco } from "../entities/Endereco";
import { Request as SystemRequest } from "../entities/Request";
import { AuthRequest, authMiddleware, requireRole } from "../middlewares/auth";
import { getImageUrl, saveImage, deleteImage, UNSUPPORTED_IMAGE_MESSAGE } from "../utils/image";
import { searchBooks, downloadCoverToUploads } from "../services/bookLookup";
import {
  syncAuthorsForBook,
  getAuthorsForBook,
  findBookByIsbn,
  getAuthorStats,
} from "../services/authorService";
import { Autor } from "../entities/Autor";
import { Editora } from "../entities/Editora";
import { LivroAutor } from "../entities/LivroAutor";
import * as path from "path";
import { sseHub, sseHandler } from "../realtime/hub";
import * as bcrypt from "bcryptjs";
import multer from "multer";

export const readerRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Helper: Optional user ID verification from request headers
const getOptionalUserId = (req: Request): number | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : authHeader;
  try {
    const decoded = require("jsonwebtoken").verify(token, process.env.JWT_SECRET || "") as any;
    return decoded.sub ? parseInt(decoded.sub) : null;
  } catch (err) {
    return null;
  }
};

// Helper: build feed item payload matching python structure
// req is optional — when null, getImageUrl falls back to BASE_URL env var
const getFeedItemDict = async (
  leitura: Leitura,
  viewerId?: number | null,
  req?: Request | null
): Promise<any> => {
  const feedLikeRepo = AppDataSource.getRepository(FeedLike);
  const feedCommentRepo = AppDataSource.getRepository(FeedComment);

  const likes_count = await feedLikeRepo.countBy({ leitura_id: leitura.id });
  const comments_count = await feedCommentRepo.countBy({ leitura_id: leitura.id });

  let liked_by_me = false;
  if (viewerId) {
    const like = await feedLikeRepo.findOneBy({ leitura_id: leitura.id, user_id: viewerId });
    liked_by_me = like !== null;
  }

  return {
    id: leitura.id,
    leitor: {
      id: leitura.leitor.id,
      nome: leitura.leitor.nome,
      imagem_url: getImageUrl(req, leitura.leitor.imagem),
    },
    livro: {
      id: leitura.livro.id,
      titulo: leitura.livro.titulo,
      autor: leitura.livro.autor,
      imagem_url: getImageUrl(req, leitura.livro.imagem),
    },
    status: leitura.status,
    nota: leitura.nota,
    comentario: leitura.comentario,
    criado_em: leitura.criado_em ? leitura.criado_em.toISOString() : null,
    likes_count,
    comments_count,
    liked_by_me,
  };
};

const toDateKey = (date?: Date | null): string => date ? date.toISOString().slice(0, 10) : "";

const countConsecutiveDays = (dateKeys: Set<string>, from = new Date()): number => {
  let count = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (dateKeys.has(toDateKey(cursor))) {
    count += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return count;
};

const compactBook = (req: Request, livro?: Livro | null, extra: Record<string, any> = {}) => {
  if (!livro) return null;
  return {
    id: livro.id,
    titulo: livro.titulo,
    autor: livro.autor,
    paginas: livro.paginas || 0,
    genero: livro.genero,
    imagem_url: getImageUrl(req, livro.imagem),
    ...extra,
  };
};

// 1. RANDOM QUOTE
readerRouter.get("/random-quote", async (req: Request, res: Response) => {
  const lecturaRepo = AppDataSource.getRepository(Leitura);

  try {
    const leitura = await lecturaRepo
      .createQueryBuilder("leitura")
      .leftJoinAndSelect("leitura.livro", "livro")
      .where("leitura.comentario IS NOT NULL AND leitura.comentario != ''")
      .orderBy("RANDOM()")
      .getOne();

    if (leitura && leitura.livro) {
      return res.status(200).json({
        quote: leitura.comentario,
        author: leitura.livro.autor,
        book: leitura.livro.titulo,
      });
    }

    return res.status(200).json({
      quote: "Eles passarão... Eu passarinho!",
      author: "Mário Quintana",
      book: "A Rua dos Cataventos",
    });
  } catch (err) {
    console.error("Error fetching random quote:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 2. LIST PUBLISHERS
readerRouter.get("/editors", async (req: Request, res: Response) => {
  const userRepo = AppDataSource.getRepository(User);
  try {
    const rows = await userRepo.find({
      where: { papel: "editor" },
      order: { nome: "ASC" },
    });
    return res.status(200).json(rows.map((u) => ({ id: u.id, nome: u.nome })));
  } catch (err) {
    console.error("Error listing editors:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

readerRouter.get("/editoras", async (req: Request, res: Response) => {
  const editoraRepo = AppDataSource.getRepository(Editora);
  try {
    const search = req.query.search ? String(req.query.search).trim() : "";
    const whereClause = search
      ? [{ nome: require("typeorm").ILike(`%${search}%`) }]
      : {};

    const editoras = await editoraRepo.find({
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

readerRouter.post("/editoras", authMiddleware(), upload.single("imagem"), async (req: AuthRequest, res: Response) => {
  const { nome } = req.body || {};
  if (!nome || !String(nome).trim()) {
    return res.status(400).json({ message: "Nome da editora é obrigatório" });
  }

  const editoraRepository = AppDataSource.getRepository(Editora);
  const userRepository = AppDataSource.getRepository(User);

  try {
    const normalizedName = String(nome).trim();
    const existingEditora = await editoraRepository.findOneBy({ nome: normalizedName });
    if (existingEditora) {
      return res.status(400).json({ message: "Já existe uma Editora com este nome" });
    }

    const existingEditorUser = await userRepository.findOneBy({ nome: normalizedName, papel: "editor" });
    if (existingEditorUser) {
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
    novaEditora.nome = normalizedName;
    novaEditora.imagem = imagem_path;

    await editoraRepository.save(novaEditora);

    return res.status(201).json({
      id: novaEditora.id,
      nome: novaEditora.nome,
      imagem_url: getImageUrl(req, novaEditora.imagem),
      criado_em: novaEditora.criado_em.toISOString(),
    });
  } catch (err) {
    console.error("Error creating editora:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 2.1. READER STATISTICS
readerRouter.get("/statistics", authMiddleware(), requireRole("leitor"), async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const requestedYear = parseInt(String(req.query.year || new Date().getFullYear()));
  const year = Number.isFinite(requestedYear) ? requestedYear : new Date().getFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));

  const leituraRepo = AppDataSource.getRepository(Leitura);
  const livroRepo = AppDataSource.getRepository(Livro);
  const feedLikeRepo = AppDataSource.getRepository(FeedLike);
  const feedCommentRepo = AppDataSource.getRepository(FeedComment);
  const editoraRepo = AppDataSource.getRepository(Editora);
  const livroAutorRepo = AppDataSource.getRepository(LivroAutor);

  try {
    const allUserReadings = await leituraRepo.find({
      where: { leitor_id: userId },
      relations: ["livro", "livro.editora"],
      order: { atualizado_em: "DESC", criado_em: "DESC" },
    });

    const years = Array.from(
      new Set([
        new Date().getFullYear(),
        ...allUserReadings.map((r) => (r.atualizado_em || r.criado_em || new Date()).getUTCFullYear()),
      ])
    ).sort((a, b) => b - a);

    const readingsInYear = allUserReadings.filter((r) => {
      const date = r.atualizado_em || r.criado_em;
      return date && date >= start && date < end;
    });
    const readInYear = readingsInYear.filter((r) => r.status === "lido");
    const currentReadings = allUserReadings.filter((r) => r.status === "lendo").length;
    const unreadReadings = allUserReadings.filter((r) => r.status === "quero_ler");

    const pageCount = (r: Leitura) => r.livro?.paginas || r.paginas_lidas || 0;
    const readPages = readInYear.reduce((sum, r) => sum + pageCount(r), 0);
    const readCount = readInYear.length;
    const ratingsCount = readInYear.filter((r) => r.nota !== null && r.nota !== undefined).length;
    const reviewsCount = readInYear.filter((r) => (r.comentario || "").trim().length > 0).length;
    const averageRating = ratingsCount
      ? readInYear.reduce((sum, r) => sum + (r.nota || 0), 0) / ratingsCount
      : 0;

    const now = new Date();
    const day = now.getUTCDay();
    const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
    const weekDays = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setUTCDate(weekStart.getUTCDate() + index);
      const key = toDateKey(date);
      return {
        key,
        active: allUserReadings.some((r) => toDateKey(r.atualizado_em || r.criado_em) === key),
        today: key === toDateKey(now),
      };
    });
    const weekHistoryCount = weekDays.filter((d) => d.active).length;

    const readDateKeys = new Set(readInYear.map((r) => toDateKey(r.atualizado_em || r.criado_em)));
    const consecutiveDays = countConsecutiveDays(readDateKeys, now);
    const elapsedDays = year === now.getUTCFullYear()
      ? Math.max(1, Math.ceil((now.getTime() - start.getTime()) / 86400000) + 1)
      : 365 + (new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 1 : 0);
    const pagesPerDay = readPages / elapsedDays;

    const ratingsByReaction: Record<string, { label: string; emoji: string; count: number }> = {
      love: { label: "Amei", emoji: "😍", count: 0 },
      excited: { label: "Empolgado", emoji: "🤩", count: 0 },
      laughing: { label: "Rindo", emoji: "😂", count: 0 },
      frustrated: { label: "Frustrado", emoji: "🙄", count: 0 },
      crying: { label: "Chorando", emoji: "😭", count: 0 },
    };
    for (const reading of readInYear) {
      if (reading.nota === 5) ratingsByReaction.love.count += 1;
      if (reading.nota === 4) ratingsByReaction.excited.count += 1;
      if (reading.nota === 3) ratingsByReaction.laughing.count += 1;
      if (reading.nota === 2) ratingsByReaction.frustrated.count += 1;
      if (reading.nota === 1) ratingsByReaction.crying.count += 1;
    }
    const reactions = Object.values(ratingsByReaction).map((r) => ({
      ...r,
      percent: ratingsCount ? Math.round((r.count / ratingsCount) * 100) : 0,
    }));
    const topReaction = reactions.reduce((best, r) => (r.count > best.count ? r : best), reactions[0]);

    const byMonth = Array.from({ length: 12 }, (_, month) => ({
      month: month + 1,
      count: readInYear.filter((r) => (r.atualizado_em || r.criado_em).getUTCMonth() === month).length,
    }));

    const groupCount = <T extends string | number>(items: T[]) => {
      const map = new Map<T, number>();
      for (const item of items) map.set(item, (map.get(item) || 0) + 1);
      return Array.from(map.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    };

    const genres = groupCount(
      readInYear.map((r) => (r.livro?.genero || "Sem gênero").trim()).filter(Boolean)
    ).slice(0, 8);

    const editors = groupCount(
      readInYear.map((r) => r.livro?.editora?.nome || "Sem editora")
    ).slice(0, 4);
    const editorImages = new Map<string, string | null>();
    for (const editor of await editoraRepo.find()) {
      editorImages.set(editor.nome, getImageUrl(req, editor.imagem));
    }

    const bookIds = readInYear.map((r) => r.livro_id);
    let authorRows: any[] = [];
    if (bookIds.length > 0) {
      authorRows = await livroAutorRepo
        .createQueryBuilder("livro_autor")
        .leftJoinAndSelect("livro_autor.autor", "autor")
        .where("livro_autor.livro_id IN (:...bookIds)", { bookIds })
        .getMany();
    }
    const authorsByBook = new Map<number, any[]>();
    for (const row of authorRows) {
      const list = authorsByBook.get(row.livro_id) || [];
      list.push(row.autor);
      authorsByBook.set(row.livro_id, list);
    }
    const authorStats = groupCount(
      readInYear.flatMap((r) => {
        const authors = authorsByBook.get(r.livro_id);
        return authors && authors.length ? authors.map((a) => a.nome) : [r.livro?.autor || "Autor desconhecido"];
      })
    ).slice(0, 4);
    const authorImages = new Map<string, string | null>();
    for (const row of authorRows) {
      if (row.autor) authorImages.set(row.autor.nome, getImageUrl(req, row.autor.imagem));
    }

    // Nationality counts: Brazilian / Foreign / Unknown
    let brazilianCount = 0;
    let foreignCount = 0;
    let unknownCount = 0;
    for (const r of readInYear) {
      const authors = authorsByBook.get(r.livro_id);
      if (authors && authors.length) {
        const anyBrazil = authors.some((a) => {
          const n = (a.nacionalidade || '').toString().toLowerCase();
          return n.startsWith('br');
        });
        if (anyBrazil) brazilianCount += 1;
        else foreignCount += 1;
      } else {
        unknownCount += 1;
      }
    }

    const sortedByPages = [...readInYear].filter((r) => pageCount(r) > 0).sort((a, b) => pageCount(b) - pageCount(a));
    const largest = sortedByPages[0] || null;
    const smallest = sortedByPages.length > 0 ? sortedByPages[sortedByPages.length - 1] : null;

    const readingIds = readInYear.map((r) => r.id);
    let commentsReceived = 0;
    let likesReceived = 0;
    if (readingIds.length > 0) {
      commentsReceived = await feedCommentRepo
        .createQueryBuilder("comment")
        .where("comment.leitura_id IN (:...readingIds)", { readingIds })
        .getCount();
      likesReceived = await feedLikeRepo
        .createQueryBuilder("like")
        .where("like.leitura_id IN (:...readingIds)", { readingIds })
        .getCount();
    }

    const popularityRows = await leituraRepo
      .createQueryBuilder("leitura")
      .leftJoinAndSelect("leitura.livro", "livro")
      .where("leitura.status = :status", { status: "lido" })
      .select(["livro.id AS id", "COUNT(leitura.id) AS readers"])
      .groupBy("livro.id")
      .orderBy("readers", "DESC")
      .limit(60)
      .getRawMany();
    const popularityIds = popularityRows.map((r) => parseInt(r.id)).filter(Boolean);
    const popularBooks = popularityIds.length > 0 ? await livroRepo.findByIds(popularityIds) : [];
    const popularityMap = new Map(popularityRows.map((r) => [parseInt(r.id), parseInt(r.readers)]));
    const popularityPayload = popularBooks
      .map((book) => ({ book, readers: popularityMap.get(book.id) || 0 }))
      .sort((a, b) => b.readers - a.readers);
    const mostPopular = popularityPayload[0] || null;
    const leastPopular = popularityPayload.length > 0 ? popularityPayload[popularityPayload.length - 1] : null;

    const topRead = [...readInYear]
      .sort((a, b) => (popularityMap.get(b.livro_id) || 0) - (popularityMap.get(a.livro_id) || 0))
      .slice(0, 10)
      .map((r, index) => ({ position: index + 1, ...compactBook(req, r.livro, { readers: popularityMap.get(r.livro_id) || 0 }) }));

    const unreadPages = unreadReadings.reduce((sum, r) => sum + pageCount(r), 0);
    const remainingDays = pagesPerDay > 0 ? Math.ceil(unreadPages / pagesPerDay) : 0;

    return res.status(200).json({
      year,
      years,
      week: {
        history_count: weekHistoryCount,
        days: weekDays,
      },
      summary: {
        read_books: readCount,
        pages_read: readPages,
        pages_per_day: Number(pagesPerDay.toFixed(1)),
        ratings_count: ratingsCount,
        reviews_count: reviewsCount,
        consecutive_days: consecutiveDays,
        current_readings: currentReadings,
        unread_books: unreadReadings.length,
        remaining_days: remainingDays,
        average_rating: Number(averageRating.toFixed(1)),
        comments_received: commentsReceived,
        likes_received: likesReceived,
      },
      reactions: {
        top: topReaction || null,
        items: reactions,
      },
      months: byMonth,
      genres,
      largest_smallest: {
        largest: largest ? compactBook(req, largest.livro, { pages: pageCount(largest) }) : null,
        smallest: smallest ? compactBook(req, smallest.livro, { pages: pageCount(smallest) }) : null,
      },
      popularity: {
        most: mostPopular ? compactBook(req, mostPopular.book, { readers: mostPopular.readers }) : null,
        least: leastPopular ? compactBook(req, leastPopular.book, { readers: leastPopular.readers }) : null,
      },
      editors: editors.map((e) => ({
        name: String(e.name),
        count: e.count,
        image_url: editorImages.get(String(e.name)) || null,
      })),
      authors: authorStats.map((a) => ({
        name: String(a.name),
        count: a.count,
        image_url: authorImages.get(String(a.name)) || null,
      })),
      top_read: topRead,
      formats: [
        { name: "Físico", icon: "book", count: readCount },
        { name: "eBook", icon: "phone", count: 0 },
        { name: "Audiobook", icon: "headphones", count: 0 },
      ],
      languages: readCount > 0 ? [{ name: "Português", code: "pt-BR", count: readCount }] : [],
      author_nationalities: [
        { name: 'Brasileiros', code: 'BR', count: brazilianCount },
        { name: 'Estrangeiros', code: 'OTHER', count: foreignCount },
        { name: 'Não informado', code: 'UNKNOWN', count: unknownCount },
      ],
    });
  } catch (err) {
    console.error("Error loading reader statistics:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 3. PUBLIC USER PROFILE SUMMARY
readerRouter.get("/users/:id", async (req: Request, res: Response) => {
  const userId = parseInt(req.params.id);
  const userRepo = AppDataSource.getRepository(User);
  const lecturaRepo = AppDataSource.getRepository(Leitura);
  const followRepo = AppDataSource.getRepository(Follow);
  
  try {
    const user = await userRepo.findOneBy({ id: userId });
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }
    
    const totalReadings = await lecturaRepo.countBy({ leitor_id: user.id, status: "lido" });
    const followersCount = await followRepo.countBy({ following_id: user.id });

    return res.status(200).json({
      id: user.id,
      nome: user.nome,
      papel: user.papel,
      imagem_url: getImageUrl(req, user.imagem),
      headline: user.headline || "Leitor da comunidade",
      bio: user.bio || "Sem biografia ainda.",
      stats: {
        lidos: totalReadings,
        seguidores: followersCount,
      }
    });
  } catch (err) {
    console.error("Error getting public user profile:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 4. PUBLIC USER PROFILE DETAIL VISIT
readerRouter.get("/users/:id/visit", async (req: Request, res: Response) => {
  const userId = parseInt(req.params.id);
  const userRepo = AppDataSource.getRepository(User);
  const libroRepo = AppDataSource.getRepository(Livro);
  const lecturaRepo = AppDataSource.getRepository(Leitura);
  const requestRepo = AppDataSource.getRepository(SystemRequest);
  const compraRepo = AppDataSource.getRepository(Compra);
  const followRepo = AppDataSource.getRepository(Follow);
  const friendshipRepo = AppDataSource.getRepository(Friendship);

  try {
    const user = await userRepo.findOneBy({ id: userId });
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    const is_editor = user.papel === "editor";

    const editorBooks = is_editor
      ? await libroRepo.find({
          where: { editor_id: user.id },
          order: { data_cadastro: "DESC" },
          take: 4,
        })
      : [];

    const readingLog =
      user.papel === "leitor"
        ? await lecturaRepo.find({
            where: { leitor_id: user.id },
            relations: ["livro"],
            order: { criado_em: "DESC" },
            take: 5,
          })
        : [];

    const totalPublications = is_editor ? await libroRepo.countBy({ editor_id: user.id }) : 0;
    const totalReadings = await lecturaRepo.countBy({ leitor_id: user.id });
    const totalRequests = await requestRepo.countBy({ leitor_id: user.id });
    const totalPurchases = await compraRepo.countBy({ leitor_id: user.id });
    const followersCount = await followRepo.countBy({ following_id: user.id });
    const followingCount = await followRepo.countBy({ follower_id: user.id });

    const friendsCount = await friendshipRepo
      .createQueryBuilder("friendship")
      .where("friendship.status = :status", { status: "accepted" })
      .andWhere(
        "(friendship.requester_id = :userId OR friendship.addressee_id = :userId)",
        { userId: user.id }
      )
      .getCount();

    const timelineDates: Date[] = [];
    if (is_editor) {
      const firstBook = await libroRepo.findOne({
        where: { editor_id: user.id },
        order: { data_cadastro: "ASC" },
      });
      if (firstBook && firstBook.data_cadastro) {
        timelineDates.push(new Date(firstBook.data_cadastro));
      }
    }

    const firstReading = await lecturaRepo.findOne({
      where: { leitor_id: user.id },
      order: { criado_em: "ASC" },
    });
    if (firstReading && firstReading.criado_em) {
      timelineDates.push(new Date(firstReading.criado_em));
    }

    const firstRequest = await requestRepo.findOne({
      where: { leitor_id: user.id },
      order: { data_criacao: "ASC" },
    });
    if (firstRequest && firstRequest.data_criacao) {
      timelineDates.push(new Date(firstRequest.data_criacao));
    }

    const firstPurchase = await compraRepo.findOne({
      where: { leitor_id: user.id },
      order: { data_compra: "ASC" },
    });
    if (firstPurchase && firstPurchase.data_compra) {
      timelineDates.push(new Date(firstPurchase.data_compra));
    }

    let tenureYears = 1;
    if (timelineDates.length > 0) {
      const oldest = new Date(Math.min(...timelineDates.map((d) => d.getTime())));
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24));
      tenureYears = Math.max(1, Math.floor(diffDays / 365));
    }

    const stats = {
      publications: totalPublications,
      citations: totalReadings + totalRequests + totalPurchases,
      tenure: `${tenureYears}y`,
      contributions: totalPublications + totalReadings + totalRequests + totalPurchases,
      followers: followersCount,
      following: followingCount,
      friends: friendsCount,
    };

    return res.status(200).json({
      user: {
        id: user.id,
        nome: user.nome,
        papel: user.papel,
        imagem_url: getImageUrl(req, user.imagem),
        headline: user.headline || (is_editor ? "Senior Scholar" : "Leitor da comunidade"),
        bio: user.bio || (is_editor ? "Dedicated to scholarly rigor." : "Active reader."),
      },
      stats,
      featured: editorBooks.map((b) => ({
        id: b.id,
        titulo: b.titulo,
        autor: b.autor,
        imagem_url: getImageUrl(req, b.imagem),
        descricao: b.descricao,
        data: b.data_cadastro ? b.data_cadastro.toISOString() : null,
        tipo: "publication",
      })),
      reading_log: readingLog.map((r) => ({
        id: r.id,
        livro_id: r.livro_id,
        titulo: r.livro.titulo,
        autor: r.livro.autor,
        status: r.status,
        nota: r.nota,
        imagem_url: getImageUrl(req, r.livro.imagem),
        criado_em: r.criado_em ? r.criado_em.toISOString() : null,
      })),
      specializations: is_editor
        ? ["Linguística", "Semiótica", "Filologia Digital", "Curadoria de Arquivos"]
        : ["Leitura", "Resenhas", "Curadoria Comunitária"],
      affiliations: is_editor
        ? [
            { nome: "Instituto de Pesquisa Semântica", cargo: "Investigador Líder" },
            { nome: "Conselho de Arquivos Digitais", cargo: "Membro do Conselho Consultivo" },
          ]
        : [{ nome: "Círculo de Leitores Lumina", cargo: "Membro Ativo" }],
    });
  } catch (err) {
    console.error("Error fetching user profile visit details:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 5. SOCIAL RELATION STATUS (Guarded)
readerRouter.get("/users/:id/relation", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const targetId = parseInt(req.params.id);

  if (current_id === targetId) {
    return res.status(200).json({
      following: false,
      is_friend: false,
      outgoing_pending: false,
      incoming_pending: false,
    });
  }

  const followRepo = AppDataSource.getRepository(Follow);
  const friendshipRepo = AppDataSource.getRepository(Friendship);

  try {
    const following = (await followRepo.findOneBy({ follower_id: current_id, following_id: targetId })) !== null;
    const outgoing_pending = (await friendshipRepo.findOneBy({ requester_id: current_id, addressee_id: targetId, status: "pending" })) !== null;
    const incoming_pending = (await friendshipRepo.findOneBy({ requester_id: targetId, addressee_id: current_id, status: "pending" })) !== null;

    const is_friend = await friendshipRepo
      .createQueryBuilder("friendship")
      .where("friendship.status = :status", { status: "accepted" })
      .andWhere(
        "((friendship.requester_id = :current_id AND friendship.addressee_id = :targetId) OR (friendship.requester_id = :targetId AND friendship.addressee_id = :current_id))",
        { current_id, targetId }
      )
      .getOne() !== null;

    return res.status(200).json({
      following,
      is_friend,
      outgoing_pending,
      incoming_pending,
    });
  } catch (err) {
    console.error("Error fetching relation status:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 6. FOLLOW USER (Guarded)
readerRouter.post("/users/:id/follow", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const targetId = parseInt(req.params.id);

  if (current_id === targetId) {
    return res.status(400).json({ message: "Operação inválida" });
  }

  const userRepo = AppDataSource.getRepository(User);
  const followRepo = AppDataSource.getRepository(Follow);

  try {
    const target = await userRepo.findOneBy({ id: targetId });
    if (!target) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    const exists = await followRepo.findOneBy({ follower_id: current_id, following_id: targetId });
    if (exists) {
      return res.status(200).json({ message: "Você já segue este perfil" });
    }

    const follow = new Follow();
    follow.follower_id = current_id;
    follow.following_id = targetId;

    await followRepo.save(follow);

    return res.status(201).json({ message: "Seguindo perfil" });
  } catch (err) {
    console.error("Error following user:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// UNFOLLOW USER (Guarded)
readerRouter.delete("/users/:id/follow", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const targetId = parseInt(req.params.id);

  const followRepo = AppDataSource.getRepository(Follow);

  try {
    const row = await followRepo.findOneBy({ follower_id: current_id, following_id: targetId });
    if (!row) {
      return res.status(404).json({ message: "Você não segue este perfil" });
    }

    await followRepo.remove(row);

    return res.status(200).json({ message: "Você deixou de seguir" });
  } catch (err) {
    console.error("Error unfollowing user:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 7. CONNECT FRIEND Convite/Aceite (Guarded)
readerRouter.post("/users/:id/connect", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const targetId = parseInt(req.params.id);

  if (current_id === targetId) {
    return res.status(400).json({ message: "Operação inválida" });
  }

  const userRepo = AppDataSource.getRepository(User);
  const friendshipRepo = AppDataSource.getRepository(Friendship);

  try {
    const target = await userRepo.findOneBy({ id: targetId });
    if (!target) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    const existingFriend = await friendshipRepo
      .createQueryBuilder("friendship")
      .where("friendship.status = :status", { status: "accepted" })
      .andWhere(
        "((friendship.requester_id = :current_id AND friendship.addressee_id = :targetId) OR (friendship.requester_id = :targetId AND friendship.addressee_id = :current_id))",
        { current_id, targetId }
      )
      .getOne();

    if (existingFriend) {
      return res.status(200).json({ message: "Conexão já existe" });
    }

    // Try incoming pending
    const incoming = await friendshipRepo.findOneBy({ requester_id: targetId, addressee_id: current_id, status: "pending" });
    if (incoming) {
      incoming.status = "accepted";
      await friendshipRepo.save(incoming);
      sseHub.publish(targetId, "notification", { kind: "friend_accepted", addressee_id: current_id });
      return res.status(200).json({ message: "Conexão aceita" });
    }

    // Try outgoing pending
    const outgoing = await friendshipRepo.findOneBy({ requester_id: current_id, addressee_id: targetId, status: "pending" });
    if (outgoing) {
      return res.status(200).json({ message: "Convite já enviado" });
    }

    const invite = new Friendship();
    invite.requester_id = current_id;
    invite.addressee_id = targetId;
    invite.status = "pending";

    await friendshipRepo.save(invite);

    sseHub.publish(targetId, "notification", { kind: "friend_request", requester_id: current_id });

    return res.status(201).json({ message: "Convite de conexão enviado" });
  } catch (err) {
    console.error("Error connecting with user:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// DISCONNECT FRIEND (Guarded)
readerRouter.delete("/users/:id/connect", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const targetId = parseInt(req.params.id);

  const friendshipRepo = AppDataSource.getRepository(Friendship);

  try {
    const row = await friendshipRepo
      .createQueryBuilder("friendship")
      .where(
        "((friendship.requester_id = :current_id AND friendship.addressee_id = :targetId) OR (friendship.requester_id = :targetId AND friendship.addressee_id = :current_id))",
        { current_id, targetId }
      )
      .getOne();

    if (!row) {
      return res.status(404).json({ message: "Sem conexão ativa" });
    }

    await friendshipRepo.remove(row);

    return res.status(200).json({ message: "Conexão removida" });
  } catch (err) {
    console.error("Error disconnecting with user:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 8. ACCEPT FRIENDSHIP BY ID (Guarded)
readerRouter.post("/friendships/:id/accept", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const friendshipId = parseInt(req.params.id);

  const friendshipRepo = AppDataSource.getRepository(Friendship);

  try {
    const row = await friendshipRepo.findOneBy({ id: friendshipId, addressee_id: current_id, status: "pending" });
    if (!row) {
      return res.status(404).json({ message: "Solicitação não encontrada" });
    }

    row.status = "accepted";
    await friendshipRepo.save(row);

    sseHub.publish(row.requester_id, "notification", { kind: "friend_accepted", addressee_id: current_id });

    return res.status(200).json({ message: "Solicitação aceita" });
  } catch (err) {
    console.error("Error accepting friendship:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// REJECT FRIENDSHIP BY ID (Guarded)
readerRouter.post("/friendships/:id/reject", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const friendshipId = parseInt(req.params.id);

  const friendshipRepo = AppDataSource.getRepository(Friendship);

  try {
    const row = await friendshipRepo.findOneBy({ id: friendshipId, addressee_id: current_id, status: "pending" });
    if (!row) {
      return res.status(404).json({ message: "Solicitação não encontrada" });
    }

    await friendshipRepo.remove(row);

    return res.status(200).json({ message: "Solicitação recusada" });
  } catch (err) {
    console.error("Error rejecting friendship:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 9. LIST NOTIFICATIONS AND UNREAD THREADS (Guarded)
readerRouter.get("/notifications", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;

  const friendshipRepo = AppDataSource.getRepository(Friendship);
  const messageRepo = AppDataSource.getRepository(Message);
  const userRepo = AppDataSource.getRepository(User);

  try {
    const friendRequests = await friendshipRepo.find({
      where: { addressee_id: current_id, status: "pending" },
      relations: ["requester"],
      order: { criado_em: "DESC" },
      take: 20,
    });

    const unreadRows = await messageRepo.find({
      where: { receiver_id: current_id, lida: false },
      relations: ["sender"],
      order: { data_envio: "DESC" },
    });

    const unreadBySender: Record<number, { count: number; latest: Message }> = {};
    unreadRows.forEach((msg) => {
      const key = msg.sender_id;
      if (!unreadBySender[key]) {
        unreadBySender[key] = { count: 0, latest: msg };
      }
      unreadBySender[key].count += 1;
    });

    const unreadMessages: any[] = [];
    for (const sender_id_str of Object.keys(unreadBySender)) {
      const senderId = parseInt(sender_id_str);
      const sender = unreadBySender[senderId].latest.sender;
      if (!sender) continue;

      const payload = unreadBySender[senderId];
      unreadMessages.push({
        sender_id: sender.id,
        sender_nome: sender.nome,
        sender_imagem_url: getImageUrl(req, sender.imagem),
        count: payload.count,
        latest_conteudo: payload.latest.conteudo,
        latest_data_envio: payload.latest.data_envio ? payload.latest.data_envio.toISOString() : null,
      });
    }

    return res.status(200).json({
      friend_requests: friendRequests.map((fr) => ({
        id: fr.id,
        requester_id: fr.requester_id,
        requester_nome: fr.requester ? fr.requester.nome : `#${fr.requester_id}`,
        requester_imagem_url: fr.requester ? getImageUrl(req, fr.requester.imagem) : null,
        criado_em: fr.criado_em ? fr.criado_em.toISOString() : null,
      })),
      unread_messages: unreadMessages,
      counts: {
        friend_requests: friendRequests.length,
        unread_message_threads: unreadMessages.length,
        unread_messages_total: unreadRows.length,
      },
    });
  } catch (err) {
    console.error("Error loading notifications:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 10. LIST CHAT MESSAGES HISTORY (Guarded)
readerRouter.get("/users/:id/messages", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const targetId = parseInt(req.params.id);
  const limit = Math.max(10, Math.min(200, parseInt(String(req.query.limit || "80")) || 80));
  const after_id = parseInt(String(req.query.after_id || "0")) || 0;

  const userRepo = AppDataSource.getRepository(User);
  const messageRepo = AppDataSource.getRepository(Message);

  try {
    const targetUser = await userRepo.findOneBy({ id: targetId });
    if (!targetUser) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    const rows = await messageRepo
      .createQueryBuilder("msg")
      .where("msg.id > :after_id", { after_id })
      .andWhere(
        "((msg.sender_id = :current_id AND msg.receiver_id = :targetId) OR (msg.sender_id = :targetId AND msg.receiver_id = :current_id))",
        { current_id, targetId }
      )
      .orderBy("msg.data_envio", "ASC")
      .take(limit)
      .getMany();

    // Mark incoming messages as read
    const toSave: Message[] = [];
    rows.forEach((m) => {
      if (m.receiver_id === current_id && !m.lida) {
        m.lida = true;
        toSave.push(m);
      }
    });

    if (toSave.length > 0) {
      await messageRepo.save(toSave);
    }

    return res.status(200).json(
      rows.map((m) => ({
        id: m.id,
        sender_id: m.sender_id,
        receiver_id: m.receiver_id,
        conteudo: m.conteudo,
        lida: m.lida,
        data_envio: m.data_envio ? m.data_envio.toISOString() : null,
      }))
    );
  } catch (err) {
    console.error("Error listing messages:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// SEND MESSAGE TO USER (Guarded)
readerRouter.post("/users/:id/messages", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const targetId = parseInt(req.params.id);

  if (current_id === targetId) {
    return res.status(400).json({ message: "Operação inválida" });
  }

  const userRepo = AppDataSource.getRepository(User);
  const messageRepo = AppDataSource.getRepository(Message);

  const { conteudo } = req.body || {};
  const cleanContent = String(conteudo || "").trim();

  if (!cleanContent) {
    return res.status(400).json({ message: "conteudo é obrigatório" });
  }

  try {
    const targetUser = await userRepo.findOneBy({ id: targetId });
    if (!targetUser) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    const msg = new Message();
    msg.sender_id = current_id;
    msg.receiver_id = targetId;
    msg.conteudo = cleanContent;
    msg.lida = false;

    const savedMsg = await messageRepo.save(msg);

    // Publish event
    sseHub.publish(targetId, "message", {
      message_id: savedMsg.id,
      sender_id: current_id,
      receiver_id: targetId,
    });

    return res.status(201).json({
      message: "Mensagem enviada",
      id: savedMsg.id,
    });
  } catch (err) {
    console.error("Error sending message:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 11. SSE REALTIME EVENT STREAM (Guarded)
readerRouter.get("/events", authMiddleware(), sseHandler);

// 12. GET EDITOR BOOKS PUBLIC (Público)
readerRouter.get("/editors/:editorId/books", async (req: Request, res: Response) => {
  const editorId = parseInt(req.params.editorId);
  const userRepo = AppDataSource.getRepository(User);
  const libroRepo = AppDataSource.getRepository(Livro);

  try {
    const editor = await userRepo.findOneBy({ id: editorId, papel: "editor" });
    if (!editor) {
      return res.status(404).json({ message: "Editora não encontrada" });
    }

    const books = await libroRepo.find({
      where: { editor_id: editorId },
      order: { titulo: "ASC" },
    });

    return res.status(200).json(
      books.map((b) => ({
        id: b.id,
        titulo: b.titulo,
        autor: b.autor,
        preco: b.preco,
        estoque: b.estoque,
        imagem_url: getImageUrl(req, b.imagem),
      }))
    );
  } catch (err) {
    console.error("Error listing editor books:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 13. LIST ALL CATALOG BOOKS (Público, Paginado)
readerRouter.get("/books", async (req: Request, res: Response) => {
  const page = parseInt(String(req.query.page || "1")) || 1;
  const perPage = parseInt(String(req.query.per_page || "12")) || 12;
  const genero = String(req.query.genero || "");
  const condicao = String(req.query.condicao || "");

  const libroRepo = AppDataSource.getRepository(Livro);

  try {
    const queryBuilder = libroRepo.createQueryBuilder("livro")
      .leftJoinAndSelect("livro.editor", "editor");

    if (genero) {
      queryBuilder.andWhere("livro.genero = :genero", { genero });
    }

    if (condicao) {
      queryBuilder.andWhere("livro.condicao = :condicao", { condicao });
    }

    const total = await queryBuilder.getCount();
    const books = await queryBuilder
      .skip((page - 1) * perPage)
      .take(perPage)
      .getMany();

    const pages = Math.ceil(total / perPage);

    return res.status(200).json({
      items: books.map((b) => ({
        id: b.id,
        titulo: b.titulo,
        autor: b.autor,
        genero: b.genero,
        condicao: b.condicao || "novo",
        preco: b.preco,
        estoque: b.estoque,
        editor_id: b.editor_id,
        status_estoque: b.estoque <= 0 ? "esgotado" : b.estoque <= 3 ? "baixo" : "disponivel",
        descricao: b.descricao,
        imagem: b.imagem,
        imagem_url: getImageUrl(req, b.imagem),
        editora: b.editor ? b.editor.nome : "",
      })),
      total,
      page,
      pages,
    });
  } catch (err) {
    console.error("Error listing catalog books:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 14. SEARCH GLOBAL (Público)
readerRouter.get("/search", async (req: Request, res: Response) => {
  const q = String(req.query.q || "").trim();
  const genero = String(req.query.genero || "").trim();
  const limit = Math.max(1, Math.min(25, parseInt(String(req.query.limit || "8")) || 8));

  if (!q && !genero) {
    return res.status(200).json({ books: [], users: [], editors: [] });
  }

  const libroRepo = AppDataSource.getRepository(Livro);
  const userRepo = AppDataSource.getRepository(User);

  try {
    const bookQB = libroRepo.createQueryBuilder("livro")
      .leftJoinAndSelect("livro.editor", "editor");

    if (q) {
      bookQB.andWhere(
        "(livro.titulo ILIKE :likeQ OR livro.autor ILIKE :likeQ OR livro.descricao ILIKE :likeQ OR editor.nome ILIKE :likeQ)",
        { likeQ: `%${q}%` }
      );
    }

    if (genero) {
      bookQB.andWhere("livro.genero ILIKE :genero", { genero });
    }

    const books = await bookQB.orderBy("livro.titulo", "ASC").take(limit).getMany();

    let users: User[] = [];
    let editors: User[] = [];

    if (q) {
      users = await userRepo.createQueryBuilder("user")
        .where("user.nome ILIKE :likeQ", { likeQ: `%${q}%` })
        .andWhere("user.papel != 'editor'")
        .orderBy("user.nome", "ASC")
        .take(limit)
        .getMany();

      editors = await userRepo.createQueryBuilder("user")
        .where("user.nome ILIKE :likeQ", { likeQ: `%${q}%` })
        .andWhere("user.papel = 'editor'")
        .orderBy("user.nome", "ASC")
        .take(limit)
        .getMany();
    }

    return res.status(200).json({
      books: books.map((b) => ({
        id: b.id,
        titulo: b.titulo,
        autor: b.autor,
        genero: b.genero,
        preco: b.preco,
        estoque: b.estoque,
        editor_id: b.editor_id,
        status_estoque: b.estoque <= 0 ? "esgotado" : b.estoque <= 3 ? "baixo" : "disponivel",
        imagem_url: getImageUrl(req, b.imagem),
        editora: b.editor ? b.editor.nome : "",
      })),
      users: users.map((u) => ({
        id: u.id,
        nome: u.nome,
        papel: u.papel,
        imagem_url: getImageUrl(req, u.imagem),
      })),
      editors: editors.map((e) => ({
        id: e.id,
        nome: e.nome,
        imagem_url: getImageUrl(req, e.imagem),
      })),
    });
  } catch (err) {
    console.error("Global search error:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

const mapAutoresSummary = (autores: Autor[]) =>
  autores.map((a) => ({ id: a.id, nome: a.nome }));

// BOOK LOOKUP (ISBN / Open Library) — usuários autenticados
readerRouter.get("/books/lookup", authMiddleware(), async (req: AuthRequest, res: Response) => {
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

    // Se parece ISBN, verificar se já existe no acervo
    const isbnLike = q.replace(/[-\s]/g, "");
    let existingBook: Livro | null = null;
    if (/^\d{10,13}$/.test(isbnLike)) {
      existingBook = await findBookByIsbn(isbnLike);
    }

    return res.status(200).json({
      items,
      existing_book: existingBook
        ? {
            id: existingBook.id,
            titulo: existingBook.titulo,
            autor: existingBook.autor,
          }
        : null,
    });
  } catch (err) {
    console.error("Error in book lookup:", err);
    return res.status(503).json({
      message: "Serviço de busca temporariamente indisponível.",
      items: [],
    });
  }
});

// GET distinct nacionalidades (available to any authenticated user)
readerRouter.get('/autores/nacionalidades', authMiddleware(), async (req: AuthRequest, res: Response) => {
  const autorRepo = AppDataSource.getRepository(Autor);
  try {
    const rows = await autorRepo
      .createQueryBuilder('autor')
      .select('DISTINCT autor.nacionalidade', 'nacionalidade')
      .where("autor.nacionalidade IS NOT NULL AND autor.nacionalidade <> ''")
      .orderBy('nacionalidade', 'ASC')
      .getRawMany();

    const list = rows.map((r: any) => r.nacionalidade).filter(Boolean);
    return res.status(200).json(list);
  } catch (err) {
    console.error('Error fetching nacionalidades (public):', err);
    return res.status(500).json({ message: 'Erro interno no servidor' });
  }
});

// COMMUNITY BOOK SUBMISSION — qualquer usuário autenticado
readerRouter.post("/books", authMiddleware(), upload.single("imagem"), async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const {
    titulo,
    autor,
    genero,
    descricao,
    open_library_cover_id,
    paginas,
    isbn,
    add_to_shelf,
    shelf_status,
    author_nationality,
  } = req.body || {};

  if (!titulo || !autor) {
    return res.status(400).json({ message: "Título e autor são obrigatórios" });
  }

  const paginasInt = parseInt(paginas || "0") || 0;
  const libroRepository = AppDataSource.getRepository(Livro);

  try {
    // Validate author_nationality if provided
    if (author_nationality && String(author_nationality).trim()) {
      const autorRepo = AppDataSource.getRepository(Autor);
      const exists = await autorRepo
        .createQueryBuilder('a')
        .where('a.nacionalidade = :n', { n: String(author_nationality).trim() })
        .getCount();
      if (exists === 0) {
        return res.status(400).json({ message: 'Nacionalidade do autor inválida: selecione uma opção existente' });
      }
    }
    if (isbn) {
      const existing = await findBookByIsbn(String(isbn));
      if (existing) {
        let readingId: number | null = null;
        if (add_to_shelf === "true" || add_to_shelf === true) {
          const leituraRepo = AppDataSource.getRepository(Leitura);
          const status = shelf_status || "quero_ler";
          let reading = await leituraRepo.findOneBy({ leitor_id: userId, livro_id: existing.id });
          if (!reading) {
            reading = leituraRepo.create({
              leitor_id: userId,
              livro_id: existing.id,
              status,
            });
            await leituraRepo.save(reading);
          }
          readingId = reading.id;
        }
        return res.status(200).json({
          message: "Este livro já está no acervo.",
          id: existing.id,
          already_exists: true,
          reading_id: readingId,
        });
      }
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
    novoLivro.submitted_by_id = userId;
    novoLivro.titulo = String(titulo).trim();
    novoLivro.autor = String(autor).trim();
    novoLivro.preco = "0.00";
    novoLivro.estoque = 0;
    novoLivro.paginas = paginasInt;
    novoLivro.genero = genero || null;
    novoLivro.condicao = "novo";
    novoLivro.descricao = descricao || null;
    novoLivro.imagem = imagem_path;
    novoLivro.isbn = isbn ? String(isbn).replace(/[-\s]/g, "") : null;

    await AppDataSource.manager.transaction(async (manager) => {
      await manager.save(novoLivro);
      await syncAuthorsForBook(novoLivro.id, novoLivro.autor, manager, author_nationality ? String(author_nationality).trim() : null);
    });

    let readingId: number | null = null;
    if (add_to_shelf === "true" || add_to_shelf === true) {
      const leituraRepo = AppDataSource.getRepository(Leitura);
      const status = shelf_status || "quero_ler";
      const reading = leituraRepo.create({
        leitor_id: userId,
        livro_id: novoLivro.id,
        status,
      });
      await leituraRepo.save(reading);
      readingId = reading.id;
    }

    return res.status(201).json({
      message: "Livro cadastrado no acervo com sucesso!",
      id: novoLivro.id,
      already_exists: false,
      reading_id: readingId,
    });
  } catch (err) {
    console.error("Error submitting book:", err);
    if ((err as any).name === "QueryFailedError") {
      return res.status(400).json({ message: "Dados inválidos ou livro duplicado" });
    }
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// UPDATE COMMUNITY BOOK — quem cadastrou ou admin
readerRouter.put("/books/:id", authMiddleware(), upload.single("imagem"), async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const userRole = req.user!.papel;
  const bookId = parseInt(req.params.id);
  const libroRepository = AppDataSource.getRepository(Livro);

  try {
    const livro = await libroRepository.findOneBy({ id: bookId });
    if (!livro) {
      return res.status(404).json({ message: "Livro não encontrado" });
    }

    const canEdit = livro.submitted_by_id === userId || userRole === "admin";
    if (!canEdit) {
      return res.status(403).json({ message: "Você não pode editar este livro" });
    }

    const body = req.body || {};

    if ("titulo" in body) livro.titulo = String(body.titulo).trim();
    if ("autor" in body) livro.autor = String(body.autor).trim();
    if ("genero" in body) livro.genero = body.genero || null;
    if ("descricao" in body) livro.descricao = body.descricao || null;
    if ("isbn" in body) {
      livro.isbn = body.isbn ? String(body.isbn).replace(/[-\s]/g, "") : null;
    }
    if ("paginas" in body) {
      const paginasInt = parseInt(body.paginas);
      livro.paginas = isNaN(paginasInt) ? 0 : paginasInt;
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

    await AppDataSource.manager.transaction(async (manager) => {
      await manager.save(livro);
      if ("autor" in body) {
        // Validate nationality if provided in update
        if (body.author_nationality && String(body.author_nationality).trim()) {
          const autorRepo = AppDataSource.getRepository(Autor);
          const exists = await autorRepo
            .createQueryBuilder('a')
            .where('a.nacionalidade = :n', { n: String(body.author_nationality).trim() })
            .getCount();
          if (exists === 0) {
            throw new Error('invalid_nationality');
          }
        }
        await syncAuthorsForBook(livro.id, livro.autor, manager, body.author_nationality ? String(body.author_nationality).trim() : null);
      }
    });

    // If we threw invalid nationality inside transaction, catch and return 400

    return res.status(200).json({ message: "Livro atualizado com sucesso" });
  } catch (err) {
    console.error("Error updating community book:", err);
    if ((err as any).name === "QueryFailedError") {
      return res.status(400).json({ message: "Dados inválidos" });
    }
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// SEARCH AUTHORS
readerRouter.get("/autores/search", async (req: Request, res: Response) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) {
    return res.status(200).json({ items: [] });
  }

  try {
    const autores = await AppDataSource.getRepository(Autor)
      .createQueryBuilder("autor")
      .where("autor.nome ILIKE :q", { q: `%${q}%` })
      .orderBy("autor.nome", "ASC")
      .take(15)
      .getMany();

    return res.status(200).json({
      items: autores.map((a) => ({ id: a.id, nome: a.nome })),
    });
  } catch (err) {
    console.error("Error searching authors:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// AUTHOR PROFILE
readerRouter.get("/autores/:id", async (req: Request, res: Response) => {
  const autorId = parseInt(req.params.id);
  const autorRepo = AppDataSource.getRepository(Autor);
  const libroRepo = AppDataSource.getRepository(Livro);

  try {
    const autor = await autorRepo.findOneBy({ id: autorId });
    if (!autor) {
      return res.status(404).json({ message: "Autor não encontrado" });
    }

    const stats = await getAuthorStats(autorId);

    const livros = await libroRepo
      .createQueryBuilder("livro")
      .innerJoin("livro_autor", "la", "la.livro_id = livro.id")
      .where("la.autor_id = :autorId", { autorId })
      .orderBy("livro.titulo", "ASC")
      .take(50)
      .getMany();

    return res.status(200).json({
      id: autor.id,
      nome: autor.nome,
      slug: autor.slug,
      bio: autor.bio,
      imagem_url: getImageUrl(req, autor.imagem),
      total_livros: stats.total_livros,
      total_leituras: stats.total_leituras,
      livros: livros.map((b) => ({
        id: b.id,
        titulo: b.titulo,
        autor: b.autor,
        genero: b.genero,
        imagem_url: getImageUrl(req, b.imagem),
      })),
    });
  } catch (err) {
    console.error("Error fetching author:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 15. BOOK DETAILS BY ID (Optional JWT)
readerRouter.get("/books/:id", async (req: Request, res: Response) => {
  const bookId = parseInt(req.params.id);
  const libroRepo = AppDataSource.getRepository(Livro);
  const lecturaRepo = AppDataSource.getRepository(Leitura);

  try {
    const book = await libroRepo.findOne({
      where: { id: bookId },
      relations: ["editor", "editora"],
    });

    if (!book) {
      return res.status(404).json({ message: "Livro não encontrado" });
    }

    let my_reading: any = null;
    let can_edit = false;

    const currentUserId = getOptionalUserId(req);
    if (currentUserId) {
      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOneBy({ id: currentUserId });
      if (user) {
        can_edit = book.submitted_by_id === user.id || user.papel === "admin";
        if (user.papel === "leitor") {
          const reading = await lecturaRepo.findOneBy({ leitor_id: user.id, livro_id: book.id });
          if (reading) {
            my_reading = {
              id: reading.id,
              status: reading.status,
              nota: reading.nota,
              comentario: reading.comentario,
              paginas_lidas: reading.paginas_lidas,
            };
          }
        }
      }
    }

    return res.status(200).json({
      id: book.id,
      titulo: book.titulo,
      autor: book.autor,
      isbn: book.isbn,
      autores: mapAutoresSummary(await getAuthorsForBook(book.id)),
      preco: book.preco,
      estoque: book.estoque,
      paginas: book.paginas,
      editor_id: book.editor_id,
      submitted_by_id: book.submitted_by_id,
      can_edit,
      status_estoque: book.estoque <= 0 ? "esgotado" : book.estoque <= 3 ? "baixo" : "disponivel",
      descricao: book.descricao,
      genero: book.genero,
      condicao: book.condicao || "novo",
      imagem: book.imagem,
      imagem_url: getImageUrl(req, book.imagem),
      editora: book.editora ? book.editora.nome : "",
      editora_imagem_url: book.editora ? getImageUrl(req, book.editora.imagem) : null,
      publicador: book.editor
        ? {
            id: book.editor.id,
            nome: book.editor.nome,
            papel: book.editor.papel,
            imagem_url: getImageUrl(req, book.editor.imagem),
          }
        : null,
      data_cadastro: book.data_cadastro ? book.data_cadastro.toISOString() : null,
      my_reading,
    });
  } catch (err) {
    console.error("Error getting book details:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 16. CREATE OR UPDATE READING LOG (Guarded & Leitor-Only)
readerRouter.post("/readings", authMiddleware(), requireRole("leitor"), async (req: AuthRequest, res: Response) => {
  const leitor_id = req.user!.id;
  const { livro_id, status = "lendo", nota, comentario, paginas_lidas } = req.body || {};

  if (!livro_id) {
    return res.status(400).json({ message: "livro_id é obrigatório" });
  }

  if (!["quero_ler", "lendo", "lido"].includes(status)) {
    return res.status(400).json({ message: "status inválido" });
  }

  let finalNota: number | null = null;
  if (nota !== undefined && nota !== null) {
    const notaInt = parseInt(nota);
    if (isNaN(notaInt) || notaInt < 1 || notaInt > 5) {
      return res.status(400).json({ message: "nota deve ser entre 1 e 5" });
    }
    finalNota = notaInt;
  }

  let finalPaginasLidas = 0;
  if (paginas_lidas !== undefined && paginas_lidas !== null) {
    const parsed = parseInt(paginas_lidas);
    if (!isNaN(parsed) && parsed >= 0) {
      finalPaginasLidas = parsed;
    }
  }

  const libroRepo = AppDataSource.getRepository(Livro);
  const lecturaRepo = AppDataSource.getRepository(Leitura);

  try {
    const book = await libroRepo.findOneBy({ id: parseInt(livro_id) });
    if (!book) {
      return res.status(404).json({ message: "Livro não encontrado" });
    }

    let reading = await lecturaRepo.findOneBy({ leitor_id, livro_id: book.id });
    let msg = "Leitura registrada";
    let status_code = 201;

    if (reading) {
      reading.status = status;
      reading.nota = finalNota;
      reading.comentario = comentario || null;
      reading.paginas_lidas = finalPaginasLidas;
      msg = "Leitura atualizada";
      status_code = 200;
    } else {
      reading = new Leitura();
      reading.leitor_id = leitor_id;
      reading.livro_id = book.id;
      reading.status = status;
      reading.nota = finalNota;
      reading.comentario = comentario || null;
      reading.paginas_lidas = finalPaginasLidas;
    }

    const saved = await lecturaRepo.save(reading);

    return res.status(status_code).json({
      message: msg,
      id: saved.id,
    });
  } catch (err) {
    console.error("Error setting reading log:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 17. LIST USER READINGS (Guarded)
readerRouter.get("/readings", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_user_id = req.user!.id;
  const target_user_id = parseInt(String(req.query.user_id || current_user_id)) || current_user_id;
  const page = parseInt(String(req.query.page || "1")) || 1;
  const perPage = parseInt(String(req.query.per_page || "10")) || 10;
  const status = String(req.query.status || "").trim();

  const lecturaRepo = AppDataSource.getRepository(Leitura);

  try {
    const qb = lecturaRepo.createQueryBuilder("leitura")
      .leftJoinAndSelect("leitura.livro", "livro")
      .leftJoinAndSelect("livro.editor", "editor")
      .where("leitura.leitor_id = :target_user_id", { target_user_id });

    if (status) {
      qb.andWhere("leitura.status = :status", { status });
    }

    qb.orderBy("leitura.atualizado_em", "DESC")
      .addOrderBy("leitura.criado_em", "DESC");

    const total = await qb.getCount();
    const rows = await qb
      .skip((page - 1) * perPage)
      .take(perPage)
      .getMany();

    const pages = Math.ceil(total / perPage);

    return res.status(200).json({
      items: rows.map((r) => ({
        id: r.id,
        livro: {
          id: r.livro.id,
          titulo: r.livro.titulo,
          autor: r.livro.autor,
          descricao: r.livro.descricao,
          imagem_url: getImageUrl(req, r.livro.imagem),
          editora: r.livro.editor ? r.livro.editor.nome : "",
          paginas: r.livro.paginas,
        },
        status: r.status,
        nota: r.nota,
        comentario: r.comentario,
        paginas_lidas: r.paginas_lidas,
        criado_em: r.criado_em ? r.criado_em.toISOString() : null,
        atualizado_em: r.atualizado_em ? r.atualizado_em.toISOString() : null,
      })),
      total,
      page,
      pages,
    });
  } catch (err) {
    console.error("Error listing readings:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 18. UPDATE READING LOG BY ID (Guarded & Leitor-Only)
readerRouter.put("/readings/:id", authMiddleware(), requireRole("leitor"), async (req: AuthRequest, res: Response) => {
  const leitor_id = req.user!.id;
  const readingId = parseInt(req.params.id);
  const data = req.body || {};

  const lecturaRepo = AppDataSource.getRepository(Leitura);

  try {
    const leitura = await lecturaRepo.findOneBy({ id: readingId, leitor_id });
    if (!leitura) {
      return res.status(404).json({ message: "Registro de leitura não encontrado" });
    }

    if ("status" in data) {
      if (!["quero_ler", "lendo", "lido"].includes(data.status)) {
        return res.status(400).json({ message: "status inválido" });
      }
      leitura.status = data.status;
    }

    if ("nota" in data) {
      if (data.nota !== null && data.nota !== undefined) {
        const notaInt = parseInt(data.nota);
        if (isNaN(notaInt) || notaInt < 1 || notaInt > 5) {
          return res.status(400).json({ message: "nota deve ser entre 1 e 5" });
        }
        leitura.nota = notaInt;
      } else {
        leitura.nota = null;
      }
    }

    if ("comentario" in data) {
      leitura.comentario = data.comentario || null;
    }

    if ("paginas_lidas" in data) {
      const parsed = parseInt(data.paginas_lidas);
      leitura.paginas_lidas = isNaN(parsed) ? 0 : parsed;
    }

    await lecturaRepo.save(leitura);

    return res.status(200).json({
      message: "Leitura updated com sucesso",
      id: leitura.id,
    });
  } catch (err) {
    console.error("Error updating reading:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 19. DELETE READING LOG BY ID (Guarded & Leitor-Only)
readerRouter.delete("/readings/:id", authMiddleware(), requireRole("leitor"), async (req: AuthRequest, res: Response) => {
  const leitor_id = req.user!.id;
  const readingId = parseInt(req.params.id);

  const lecturaRepo = AppDataSource.getRepository(Leitura);
  const feedLikeRepo = AppDataSource.getRepository(FeedLike);
  const feedCommentRepo = AppDataSource.getRepository(FeedComment);

  try {
    const leitura = await lecturaRepo.findOneBy({ id: readingId, leitor_id });
    if (!leitura) {
      return res.status(404).json({ message: "Registro de leitura não encontrado" });
    }

    // Safely delete cascade children to avoid relational conflicts
    await feedLikeRepo.delete({ leitura_id: leitura.id });
    await feedCommentRepo.delete({ leitura_id: leitura.id });

    await lecturaRepo.remove(leitura);

    return res.status(200).json({ message: "Leitura removida com sucesso" });
  } catch (err) {
    console.error("Error deleting reading:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 20. RECOMMENDATIONS TOP RATED BOOKS
readerRouter.get("/recommendations", async (req: Request, res: Response) => {
  const page = parseInt(String(req.query.page || "1")) || 1;
  const perPage = parseInt(String(req.query.per_page || "6")) || 6;

  const libroRepo = AppDataSource.getRepository(Livro);

  try {
    // Perform subquery mapping for average ratings
    const total = await libroRepo.count();

    const rawResults = await libroRepo
      .createQueryBuilder("livro")
      .leftJoin(Leitura, "leitura", "leitura.livro_id = livro.id AND leitura.nota IS NOT NULL")
      .select([
        "livro.id AS id",
        "livro.titulo AS titulo",
        "livro.autor AS autor",
        "livro.imagem AS imagem",
        "COALESCE(AVG(leitura.nota), 0) AS average_rating",
      ])
      .groupBy("livro.id")
      .orderBy("average_rating", "DESC")
      .addOrderBy("livro.data_cadastro", "DESC")
      .offset((page - 1) * perPage)
      .limit(perPage)
      .getRawMany();

    const pages = Math.ceil(total / perPage);

    return res.status(200).json({
      items: rawResults.map((r) => ({
        id: parseInt(r.id),
        titulo: r.titulo,
        autor: r.autor,
        imagem_url: getImageUrl(req, r.imagem),
        average_rating: parseFloat(parseFloat(r.average_rating).toFixed(1)),
      })),
      total,
      page,
      pages,
    });
  } catch (err) {
    console.error("Recommendations failed:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 21. PUBLIC READING ACTIVITY FEED (Optional JWT)
readerRouter.get("/feed", async (req: Request, res: Response) => {
  const page = parseInt(String(req.query.page || "1")) || 1;
  const perPage = parseInt(String(req.query.per_page || "20")) || 20;
  const viewerId = getOptionalUserId(req);

  const lecturaRepo = AppDataSource.getRepository(Leitura);

  try {
    const total = await lecturaRepo.count();
    const rows = await lecturaRepo.find({
      relations: ["leitor", "livro"],
      order: { criado_em: "DESC" },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    const items: any[] = [];
    for (const r of rows) {
      items.push(await getFeedItemDict(r, viewerId, req));
    }

    const pages = Math.ceil(total / perPage);

    return res.status(200).json({
      items,
      total,
      page,
      pages,
    });
  } catch (err) {
    console.error("Error loading feed:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 22. TOGGLE FEED LIKE (Guarded)
readerRouter.post("/feed/:id/like", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const user_id = req.user!.id;
  const reading_id = parseInt(req.params.id);

  const lecturaRepo = AppDataSource.getRepository(Leitura);
  const feedLikeRepo = AppDataSource.getRepository(FeedLike);

  try {
    const lectura = await lecturaRepo.findOneBy({ id: reading_id });
    if (!lectura) {
      return res.status(404).json({ message: "Atividade não encontrada" });
    }

    const existing = await feedLikeRepo.findOneBy({ leitura_id: reading_id, user_id });
    let liked = false;

    if (existing) {
      await feedLikeRepo.remove(existing);
      liked = false;
    } else {
      const like = new FeedLike();
      like.leitura_id = reading_id;
      like.user_id = user_id;
      await feedLikeRepo.save(like);
      liked = true;
    }

    const count = await feedLikeRepo.countBy({ leitura_id: reading_id });
    return res.status(200).json({ liked, likes_count: count });
  } catch (err) {
    console.error("Error toggling like:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 23. LIST FEED POST COMMENTS (Público)
readerRouter.get("/feed/:id/comments", async (req: Request, res: Response) => {
  const reading_id = parseInt(req.params.id);
  const lecturaRepo = AppDataSource.getRepository(Leitura);
  const feedCommentRepo = AppDataSource.getRepository(FeedComment);

  try {
    const leitura = await lecturaRepo.findOneBy({ id: reading_id });
    if (!leitura) {
      return res.status(404).json({ message: "Atividade não encontrada" });
    }

    const rows = await feedCommentRepo.find({
      where: { leitura_id: reading_id },
      relations: ["user"],
      order: { criado_em: "ASC" },
    });

    return res.status(200).json(
      rows.map((c) => ({
        id: c.id,
        user_id: c.user_id,
        user_nome: c.user ? c.user.nome : "",
        user_imagem_url: getImageUrl(req, c.user ? c.user.imagem : null),
        conteudo: c.conteudo,
        criado_em: c.criado_em ? c.criado_em.toISOString() : null,
      }))
    );
  } catch (err) {
    console.error("Error listing comments:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// SUBMIT FEED POST COMMENT (Guarded)
readerRouter.post("/feed/:id/comments", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const user_id = req.user!.id;
  const reading_id = parseInt(req.params.id);
  const { conteudo } = req.body || {};
  const cleanContent = String(conteudo || "").trim();

  if (!cleanContent) {
    return res.status(400).json({ message: "Comentário não pode ser vazio" });
  }

  if (cleanContent.length > 2000) {
    return res.status(400).json({ message: "Comentário muito longo" });
  }

  const lecturaRepo = AppDataSource.getRepository(Leitura);
  const feedCommentRepo = AppDataSource.getRepository(FeedComment);

  try {
    const leitura = await lecturaRepo.findOneBy({ id: reading_id });
    if (!leitura) {
      return res.status(404).json({ message: "Atividade não encontrada" });
    }

    const comment = new FeedComment();
    comment.leitura_id = reading_id;
    comment.user_id = user_id;
    comment.conteudo = cleanContent;

    const saved = await feedCommentRepo.save(comment);
    const count = await feedCommentRepo.countBy({ leitura_id: reading_id });

    return res.status(201).json({
      id: saved.id,
      comments_count: count,
      message: "Comentário publicado",
    });
  } catch (err) {
    console.error("Error posting comment:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 24. GET BOOK REVIEWS (Público)
readerRouter.get("/books/:id/reviews", async (req: Request, res: Response) => {
  const book_id = parseInt(req.params.id);
  const libroRepo = AppDataSource.getRepository(Livro);
  const lecturaRepo = AppDataSource.getRepository(Leitura);

  try {
    const book = await libroRepo.findOneBy({ id: book_id });
    if (!book) {
      return res.status(404).json({ message: "Livro não encontrado" });
    }

    // Fetch up to 50 readings that have either rating or comment
    const rows = await lecturaRepo
      .createQueryBuilder("leitura")
      .leftJoinAndSelect("leitura.leitor", "leitor")
      .where("leitura.livro_id = :book_id", { book_id })
      .andWhere("(leitura.nota IS NOT NULL OR (leitura.comentario IS NOT NULL AND leitura.comentario != ''))")
      .orderBy("leitura.criado_em", "DESC")
      .take(50)
      .getMany();

    return res.status(200).json(
      rows.map((r) => ({
        id: r.id,
        leitor_id: r.leitor_id,
        leitor_nome: r.leitor ? r.leitor.nome : "",
        leitor_imagem_url: r.leitor ? getImageUrl(req, r.leitor.imagem) : null,
        nota: r.nota,
        comentario: r.comentario,
        status: r.status,
        criado_em: r.criado_em ? r.criado_em.toISOString() : null,
      }))
    );
  } catch (err) {
    console.error("Error fetching reviews:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 25. CREATE NEW REQUEST TO PUBLISHER (Guarded & Leitor-Only)
readerRouter.post("/requests", authMiddleware(), requireRole("leitor"), async (req: AuthRequest, res: Response) => {
  const leitor_id = req.user!.id;
  const { editor_id, livro_id, conteudo } = req.body || {};

  if (editor_id === undefined || livro_id === undefined) {
    return res.status(400).json({ message: "editor_id e livro_id são obrigatórios" });
  }

  const userRepo = AppDataSource.getRepository(User);
  const libroRepo = AppDataSource.getRepository(Livro);
  const requestRepo = AppDataSource.getRepository(SystemRequest);

  try {
    const editor = await userRepo.findOneBy({ id: parseInt(editor_id), papel: "editor" });
    if (!editor) {
      return res.status(404).json({ message: "Editora não encontrada" });
    }

    const libro = await libroRepo.findOneBy({ id: parseInt(livro_id), editor_id: editor.id });
    if (!libro) {
      return res.status(404).json({ message: "Livro não encontrado para esta editora" });
    }

    const cleanContent = String(conteudo || "").trim();
    const msg = cleanContent || `Tenho interesse no livro '${libro.titulo}'.`;

    const requestObj = new SystemRequest();
    requestObj.leitor_id = leitor_id;
    requestObj.editor_id = editor.id;
    requestObj.livro_id = libro.id;
    requestObj.conteudo = msg;
    requestObj.status = "pendente";

    const saved = await requestRepo.save(requestObj);

    return res.status(201).json({
      message: "Solicitação enviada",
      id: saved.id,
    });
  } catch (err) {
    console.error("Error creating reader request:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 26. BUY BOOK SHORTCUT SINGLE CHECKOUT (Guarded & Leitor-Only)
readerRouter.post("/purchases", authMiddleware(), requireRole("leitor"), async (req: AuthRequest, res: Response) => {
  const leitor_id = req.user!.id;
  const { livro_id, quantidade = 1 } = req.body || {};

  const qty = parseInt(quantidade);
  if (isNaN(qty) || qty <= 0) {
    return res.status(400).json({ message: "quantidade deve ser maior que zero" });
  }

  const libroRepo = AppDataSource.getRepository(Livro);
  const compraRepo = AppDataSource.getRepository(Compra);

  try {
    const result = await AppDataSource.transaction(async (manager) => {
      const libro = await manager.findOne(Livro, { where: { id: parseInt(livro_id) } });
      if (!libro) {
        throw new Error("Livro não encontrado");
      }

      if (libro.estoque < qty) {
        throw new Error("Estoque insuficiente");
      }

      const preco = parseFloat(libro.preco || "0");
      if (!Number.isFinite(preco) || preco <= 0) {
        throw new Error("Este livro não está disponível para venda");
      }

      libro.estoque -= qty;
      await manager.save(libro);

      const totalValue = parseFloat(libro.preco) * qty;

      const purchase = new Compra();
      purchase.leitor_id = leitor_id;
      purchase.livro_id = libro.id;
      purchase.quantidade = qty;
      purchase.total = totalValue.toFixed(2);
      purchase.status = "confirmada";

      const saved = await manager.save(purchase);
      return saved;
    });

    return res.status(201).json({
      message: "Compra realizada com sucesso",
      id: result.id,
    });
  } catch (err) {
    const error = err as Error;
    if (error.message === "Livro não encontrado") {
      return res.status(404).json({ message: error.message });
    }
    if (error.message === "Estoque insuficiente" || error.message === "Este livro não está disponível para venda") {
      return res.status(400).json({ message: error.message });
    }
    console.error("Purchase error:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// LIST PURCHASES (Guarded & Leitor-Only)
readerRouter.get("/purchases", authMiddleware(), requireRole("leitor"), async (req: AuthRequest, res: Response) => {
  const leitor_id = req.user!.id;
  const compraRepo = AppDataSource.getRepository(Compra);

  try {
    const rows = await compraRepo.find({
      where: { leitor_id },
      relations: ["livro", "livro.editor"],
      order: { data_compra: "DESC" },
    });

    return res.status(200).json(
      rows.map((c) => ({
        id: c.id,
        quantidade: c.quantidade,
        total: c.total,
        status: c.status,
        data_compra: c.data_compra ? c.data_compra.toISOString() : null,
        livro: {
          id: c.livro.id,
          titulo: c.livro.titulo,
          autor: c.livro.autor,
          imagem_url: getImageUrl(req, c.livro.imagem),
          editora: c.livro.editor ? c.livro.editor.nome : "",
        },
      }))
    );
  } catch (err) {
    console.error("Error listing purchases:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// LIST MY SENT REQUESTS TO PUBLISHERS (Guarded & Leitor-Only)
readerRouter.get("/requests", authMiddleware(), requireRole("leitor"), async (req: AuthRequest, res: Response) => {
  const leitor_id = req.user!.id;
  const page = parseInt(String(req.query.page || "1")) || 1;
  const perPage = parseInt(String(req.query.per_page || "10")) || 10;

  const requestRepo = AppDataSource.getRepository(SystemRequest);

  try {
    const total = await requestRepo.countBy({ leitor_id });
    const rows = await requestRepo.find({
      where: { leitor_id },
      relations: ["editor", "livro"],
      order: { data_criacao: "DESC" },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    const pages = Math.ceil(total / perPage);

    return res.status(200).json({
      items: rows.map((s) => ({
        id: s.id,
        editor_id: s.editor_id,
        editor_nome: s.editor ? s.editor.nome : null,
        livro_id: s.livro_id,
        livro_titulo: s.livro ? s.livro.titulo : null,
        livro_autor: s.livro ? s.livro.autor : null,
        livro_imagem_url: s.livro ? getImageUrl(req, s.livro.imagem) : null,
        conteudo: s.conteudo,
        resposta: s.resposta,
        status: s.status,
        data_criacao: s.data_criacao ? s.data_criacao.toISOString() : null,
      })),
      total,
      page,
      pages,
    });
  } catch (err) {
    console.error("Error listing reader requests:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 27. LIST CHAT CONVERSATIONS (Guarded)
readerRouter.get("/conversations", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const page = parseInt(String(req.query.page || "1")) || 1;
  const perPage = parseInt(String(req.query.per_page || "15")) || 15;

  const messageRepo = AppDataSource.getRepository(Message);
  const userRepo = AppDataSource.getRepository(User);

  try {
    const sentTo = await messageRepo
      .createQueryBuilder("msg")
      .select("msg.receiver_id", "receiver_id")
      .where("msg.sender_id = :current_id", { current_id })
      .distinct(true)
      .getRawMany();

    const receivedFrom = await messageRepo
      .createQueryBuilder("msg")
      .select("msg.sender_id", "sender_id")
      .where("msg.receiver_id = :current_id", { current_id })
      .distinct(true)
      .getRawMany();

    const userIds = new Set<number>();
    sentTo.forEach((r) => userIds.add(r.receiver_id));
    receivedFrom.forEach((r) => userIds.add(r.sender_id));

    const conversationsRaw: any[] = [];
    for (const uid of userIds) {
      const contactUser = await userRepo.findOneBy({ id: uid });
      if (!contactUser) continue;

      const lastMsg = await messageRepo.findOne({
        where: [
          { sender_id: current_id, receiver_id: uid },
          { sender_id: uid, receiver_id: current_id },
        ],
        order: { data_envio: "DESC" },
      });

      const unreadCount = await messageRepo.countBy({
        sender_id: uid,
        receiver_id: current_id,
        lida: false,
      });

      conversationsRaw.push({
        user_id: contactUser.id,
        user_nome: contactUser.nome,
        user_imagem_url: getImageUrl(req, contactUser.imagem),
        last_message: lastMsg ? lastMsg.conteudo : "",
        last_message_time: lastMsg && lastMsg.data_envio ? lastMsg.data_envio.toISOString() : null,
        unread_count: unreadCount,
      });
    }

    conversationsRaw.sort((a, b) => {
      const timeA = a.last_message_time || "";
      const timeB = b.last_message_time || "";
      return timeB.localeCompare(timeA);
    });

    const total = conversationsRaw.length;
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const items = conversationsRaw.slice(start, end);
    const pages = Math.ceil(total / perPage);

    return res.status(200).json({
      items,
      total,
      page,
      pages,
    });
  } catch (err) {
    console.error("Error listing conversations:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 28. CREATE ORDER CHECKOUT WITH MULTIPLE ITEMS (Guarded & Leitor-Only)
readerRouter.post("/orders", authMiddleware(), requireRole("leitor"), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const data = req.body || {};
  const itemsData = data.items || [];

  if (!itemsData || itemsData.length === 0) {
    return res.status(400).json({ message: "Carrinho vazio" });
  }

  try {
    const result = await AppDataSource.transaction(async (manager) => {
      const order = new Pedido();
      order.leitor_id = current_id;
      order.endereco_rua = data.rua || null;
      order.endereco_numero = data.numero || null;
      order.endereco_bairro = data.bairro || null;
      order.endereco_cidade = data.cidade || null;
      order.endereco_estado = data.estado || null;
      order.endereco_cep = data.cep || null;
      order.metodo_pagamento = data.metodo_pagamento || "simulado";
      order.total = "0.00";

      const savedOrder = await manager.save(order);
      let totalAccumulated = 0;
      const itemObjects: ItemPedido[] = [];

      for (const item of itemsData) {
        const libroId = item.livro_id;
        if (libroId === undefined || libroId === null) {
          throw new Error("livro_id é obrigatório em cada item");
        }

        const rawQty = item.quantidade;
        const qty = parseInt(rawQty);
        if (isNaN(qty) || qty <= 0) {
          throw new Error("quantidade deve ser maior que zero");
        }

        const libro = await manager.findOne(Livro, { where: { id: libroId } });
        if (!libro) {
          throw new Error(`Livro ID ${libroId} não encontrado`);
        }

        if (libro.estoque < qty) {
          throw new Error(`O livro '${libro.titulo}' possui apenas ${libro.estoque} unidades em estoque.`);
        }

        const preco = parseFloat(libro.preco || "0");
        if (!Number.isFinite(preco) || preco <= 0) {
          throw new Error(`O livro '${libro.titulo}' não está disponível para venda.`);
        }

        libro.estoque -= qty;
        await manager.save(libro);

        const subtotal = parseFloat(libro.preco) * qty;
        totalAccumulated += subtotal;

        const orderItem = new ItemPedido();
        orderItem.pedido_id = savedOrder.id;
        orderItem.livro_id = libro.id;
        orderItem.quantidade = qty;
        orderItem.preco_unitario = libro.preco;

        itemObjects.push(orderItem);
      }

      savedOrder.total = totalAccumulated.toFixed(2);
      await manager.save(savedOrder);
      await manager.save(itemObjects);

      return {
        id: savedOrder.id,
        total: savedOrder.total,
      };
    });

    return res.status(201).json({
      message: "Pedido realizado com sucesso",
      pedido_id: result.id,
      total: result.total,
    });
  } catch (err) {
    const error = err as Error;
    if (
      error.message.includes("não encontrado") ||
      error.message.includes("quantidade") ||
      error.message.includes("obrigatório") ||
      error.message.includes("estoque")
    ) {
      return res.status(400).json({ message: error.message });
    }
    console.error("Order checkout error:", err);
    return res.status(500).json({ message: "Erro interno ao processar pedido" });
  }
});

// LIST MY PLACED ORDERS (Guarded)
readerRouter.get("/orders", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const page = parseInt(String(req.query.page || "1")) || 1;
  const perPage = parseInt(String(req.query.per_page || "8")) || 8;

  const pedidoRepo = AppDataSource.getRepository(Pedido);

  try {
    const total = await pedidoRepo.countBy({ leitor_id: current_id });
    const pedidos = await pedidoRepo.find({
      where: { leitor_id: current_id },
      relations: ["itens", "itens.livro"],
      order: { data_pedido: "DESC" },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    const pages = Math.ceil(total / perPage);

    const items = pedidos.map((p) => ({
      id: p.id,
      data: p.data_pedido ? p.data_pedido.toISOString() : null,
      status: p.status,
      total: p.total,
      itens: (p.itens || []).map((item) => ({
        titulo: item.livro ? item.livro.titulo : "",
        quantidade: item.quantidade,
        preco_unitario: item.preco_unitario,
        imagem_url: item.livro ? getImageUrl(req, item.livro.imagem) : null,
      })),
    }));

    return res.status(200).json({
      items,
      total,
      page,
      pages,
    });
  } catch (err) {
    console.error("Error listing orders:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 29. SELF PROFILE MANAGEMENT (Guarded)
readerRouter.get("/profile", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const userRepo = AppDataSource.getRepository(User);
  const lecturaRepo = AppDataSource.getRepository(Leitura);
  const libroRepo = AppDataSource.getRepository(Livro);
  const followRepo = AppDataSource.getRepository(Follow);

  try {
    const user = await userRepo.findOneBy({ id: current_id });
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    const totalReadings = await lecturaRepo.countBy({ leitor_id: user.id, status: "lido" });
    const totalPublications = await libroRepo.countBy({ editor_id: user.id });
    const followersCount = await followRepo.countBy({ following_id: user.id });

    return res.status(200).json({
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        papel: user.papel,
        imagem_url: getImageUrl(req, user.imagem),
        headline: user.headline || "Leitor da comunidade",
        bio: user.bio || "Sem biografia ainda.",
      },
      stats: {
        lidos: totalReadings,
        venda: totalPublications,
        seguidores: followersCount,
      },
      generos: ["Ficção Histórica", "Filosofia", "Clássicos"],
    });
  } catch (err) {
    console.error("Profile loading error:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// UPDATE PROFILE DETAILS (Guarded)
readerRouter.put("/profile", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const userRepo = AppDataSource.getRepository(User);
  const data = req.body || {};

  try {
    const user = await userRepo.findOneBy({ id: current_id });
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    if ("nome" in data) user.nome = data.nome;
    if ("headline" in data) user.headline = data.headline;
    if ("bio" in data) user.bio = data.bio;

    await userRepo.save(user);

    return res.status(200).json({ message: "Perfil atualizado com sucesso" });
  } catch (err) {
    console.error("Error updating profile details:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// UPDATE PROFILE PHOTO (Guarded)
readerRouter.post("/profile/photo", authMiddleware(), upload.single("imagem"), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const userRepo = AppDataSource.getRepository(User);

  try {
    const user = await userRepo.findOneBy({ id: current_id });
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Nenhum arquivo enviado" });
    }

    // Delete old profile photo if it exists
    if (user.imagem) {
      deleteImage(user.imagem);
    }

    const saved = await saveImage(req.file, "users");
    if (!saved) {
      return res.status(400).json({ message: UNSUPPORTED_IMAGE_MESSAGE });
    }
    user.imagem = saved;
    await userRepo.save(user);

    return res.status(200).json({
      message: "Foto atualizada",
      imagem_url: getImageUrl(req, user.imagem),
    });
  } catch (err) {
    console.error("Error uploading profile photo:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// CHANGE PASSWORD (Guarded)
readerRouter.put("/profile/password", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const userRepo = AppDataSource.getRepository(User);
  const data = req.body || {};

  const { senha_atual, nova_senha } = data;

  if (!senha_atual || !nova_senha) {
    return res.status(400).json({ message: "Senhas atual e nova são obrigatórias" });
  }

  if (String(nova_senha).length < 6) {
    return res.status(400).json({ message: "A nova senha deve ter ao menos 6 caracteres" });
  }

  if (senha_atual === nova_senha) {
    return res.status(400).json({ message: "A nova senha deve ser diferente da atual" });
  }

  try {
    const user = await userRepo.findOneBy({ id: current_id });
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    if (!user.verificar_senha(senha_atual)) {
      return res.status(400).json({ message: "Senha atual incorreta" });
    }

    const salt = bcrypt.genSaltSync(10);
    user.senha_hash = bcrypt.hashSync(nova_senha, salt);

    await userRepo.save(user);

    return res.status(200).json({ message: "Senha alterada com sucesso" });
  } catch (err) {
    console.error("Error changing password:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// DELETE ACCOUNT (Guarded)
readerRouter.delete("/profile", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const userRepo = AppDataSource.getRepository(User);

  try {
    const user = await userRepo.findOneBy({ id: current_id });
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    if (user.imagem) {
      deleteImage(user.imagem);
    }

    await userRepo.remove(user);

    return res.status(200).json({ message: "Conta removida permanentemente" });
  } catch (err) {
    console.error("Error deleting user account:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 14. GET READER ADDRESSES (Guarded)
readerRouter.get("/addresses", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const addressRepo = AppDataSource.getRepository(Endereco);

  try {
    const addresses = await addressRepo.find({
      where: { user_id: current_id },
      order: { criado_em: "DESC" },
    });
    return res.status(200).json(addresses);
  } catch (err) {
    console.error("Error fetching reader addresses:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// 15. POST READER ADDRESS (Guarded)
readerRouter.post("/addresses", authMiddleware(), async (req: AuthRequest, res: Response) => {
  const current_id = req.user!.id;
  const addressRepo = AppDataSource.getRepository(Endereco);
  const data = req.body || {};

  const { label, rua, numero, bairro, cidade, estado, cep } = data;

  if (!label || !rua || !numero || !bairro || !cidade || !estado || !cep) {
    return res.status(400).json({ message: "Todos os campos do endereço são obrigatórios" });
  }

  try {
    const address = new Endereco();
    address.user_id = current_id;
    address.label = label;
    address.rua = rua;
    address.numero = numero;
    address.bairro = bairro;
    address.cidade = cidade;
    address.estado = estado;
    address.cep = cep;

    const saved = await addressRepo.save(address);
    return res.status(201).json(saved);
  } catch (err) {
    console.error("Error creating reader address:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});
