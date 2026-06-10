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
import { Request as SystemRequest } from "../entities/Request";
import { AuthRequest, authMiddleware, requireRole } from "../middlewares/auth";
import { getImageUrl, saveImage, deleteImage } from "../utils/image";
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

// 3. PUBLIC USER PROFILE SUMMARY
readerRouter.get("/users/:id", async (req: Request, res: Response) => {
  const userId = parseInt(req.params.id);
  const userRepo = AppDataSource.getRepository(User);
  try {
    const user = await userRepo.findOneBy({ id: userId });
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }
    return res.status(200).json({
      id: user.id,
      nome: user.nome,
      papel: user.papel,
      imagem_url: getImageUrl(req, user.imagem),
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

// 15. BOOK DETAILS BY ID (Optional JWT)
readerRouter.get("/books/:id", async (req: Request, res: Response) => {
  const bookId = parseInt(req.params.id);
  const libroRepo = AppDataSource.getRepository(Livro);
  const lecturaRepo = AppDataSource.getRepository(Leitura);

  try {
    const book = await libroRepo.findOne({
      where: { id: bookId },
      relations: ["editor"],
    });

    if (!book) {
      return res.status(404).json({ message: "Livro não encontrado" });
    }

    let my_reading: any = null;

    const currentUserId = getOptionalUserId(req);
    if (currentUserId) {
      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOneBy({ id: currentUserId });
      if (user && user.papel === "leitor") {
        const reading = await lecturaRepo.findOneBy({ leitor_id: user.id, livro_id: book.id });
        if (reading) {
          my_reading = {
            id: reading.id,
            status: reading.status,
            nota: reading.nota,
            comentario: reading.comentario,
          };
        }
      }
    }

    return res.status(200).json({
      id: book.id,
      titulo: book.titulo,
      autor: book.autor,
      preco: book.preco,
      estoque: book.estoque,
      editor_id: book.editor_id,
      status_estoque: book.estoque <= 0 ? "esgotado" : book.estoque <= 3 ? "baixo" : "disponivel",
      descricao: book.descricao,
      genero: book.genero,
      condicao: book.condicao || "novo",
      imagem: book.imagem,
      imagem_url: getImageUrl(req, book.imagem),
      editora: book.editor ? book.editor.nome : "",
      editora_imagem_url: book.editor ? getImageUrl(req, book.editor.imagem) : null,
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
  const { livro_id, status = "lendo", nota, comentario } = req.body || {};

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
      msg = "Leitura atualizada";
      status_code = 200;
    } else {
      reading = new Leitura();
      reading.leitor_id = leitor_id;
      reading.livro_id = book.id;
      reading.status = status;
      reading.nota = finalNota;
      reading.comentario = comentario || null;
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
        },
        status: r.status,
        nota: r.nota,
        comentario: r.comentario,
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
    if (error.message === "Estoque insuficiente") {
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

    user.imagem = saveImage(req.file, "users");
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
