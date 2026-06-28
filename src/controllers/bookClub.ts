import { Router, Response, Request } from "express";
import { AppDataSource } from "../config/database";
import { BookClub } from "../entities/BookClub";
import { BookClubMember } from "../entities/BookClubMember";
import { BookClubCycle } from "../entities/BookClubCycle";
import { BookClubNomination } from "../entities/BookClubNomination";
import { BookClubVote } from "../entities/BookClubVote";
import { Editora } from "../entities/Editora";
import { Livro } from "../entities/Livro";
import { User } from "../entities/User";
import { AuthRequest, authMiddleware, requireRole } from "../middlewares/auth";
import { getImageUrl, saveImage, UNSUPPORTED_IMAGE_MESSAGE } from "../utils/image";
import { syncAuthorsForBook } from "../services/authorService";
import multer from "multer";

export const bookClubRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const MAX_VOTES_PER_CYCLE = 3;
const MONTHS_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function generateInviteCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function cycleTitle(date: Date): string {
  return `${MONTHS_PT[date.getMonth()]} ${date.getFullYear()}`;
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 18, 0, 0);
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function canNominateMore(member: BookClubMember | null, user: { papel?: string } | null | undefined): boolean {
  return user?.papel === "admin" || member?.papel === "dono" || member?.allow_multiple_nominations === true;
}

async function findBookByTitleAndAuthor(title: string, author: string): Promise<Livro | null> {
  return AppDataSource.getRepository(Livro)
    .createQueryBuilder("livro")
    .where("LOWER(TRIM(livro.titulo)) = :title", { title: normalizeText(title) })
    .andWhere("LOWER(TRIM(livro.autor)) = :author", { author: normalizeText(author) })
    .getOne();
}

function daysUntil(target: Date): number {
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// Middleware de verificação de membro do clube
async function checkClubMember(req: AuthRequest, res: Response, next: any) {
  try {
    const clubId = parseInt(req.params.clubId);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Não autorizado" });

    // Admins do app têm acesso irrestrito
    if (req.user?.papel === "admin") {
      return next();
    }

    const member = await AppDataSource.getRepository(BookClubMember).findOneBy({
      book_club_id: clubId,
      user_id: userId,
      status: "active",
    });

    if (!member) {
      return res.status(403).json({ message: "Você não é membro ativo deste clube do livro" });
    }

    next();
  } catch (err) {
    res.status(500).json({ message: "Erro ao verificar permissão do clube" });
  }
}

// Middleware de verificação de dono do clube
async function checkClubOwner(req: AuthRequest, res: Response, next: any) {
  try {
    const clubId = parseInt(req.params.clubId);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Não autorizado" });

    // Admins do app podem gerenciar
    if (req.user?.papel === "admin") {
      return next();
    }

    const member = await AppDataSource.getRepository(BookClubMember).findOneBy({
      book_club_id: clubId,
      user_id: userId,
      papel: "dono",
      status: "active",
    });

    if (!member) {
      return res.status(403).json({ message: "Apenas o dono do clube pode realizar esta ação" });
    }

    next();
  } catch (err) {
    res.status(500).json({ message: "Erro ao verificar permissão do clube" });
  }
}

async function getOrCreateActiveCycle(clubId: number): Promise<BookClubCycle> {
  const repo = AppDataSource.getRepository(BookClubCycle);
  let cycle = await repo.findOne({
    where: [
      { book_club_id: clubId, status: "nominacao" },
      { book_club_id: clubId, status: "votacao" },
    ],
    order: { data_inicio: "DESC" },
  });

  if (cycle) return cycle;

  const now = new Date();
  cycle = repo.create({
    book_club_id: clubId,
    titulo: cycleTitle(now),
    status: "votacao",
    data_inicio: now,
    data_fim_votacao: endOfMonth(now),
    data_sorteio: null,
    nomination_vencedora_id: null,
  });
  return repo.save(cycle);
}

async function nominationPayload(
  nomination: BookClubNomination,
  votesCount: number,
  votedByMe: boolean,
  req: Request
) {
  const titulo = nomination.livro?.titulo ?? nomination.titulo ?? "Sem título";
  const autor = nomination.livro?.autor ?? nomination.autor ?? "Autor desconhecido";
  const imagemUrl = nomination.imagem
    ? getImageUrl(req, nomination.imagem)
    : nomination.livro?.imagem
      ? getImageUrl(req, nomination.livro.imagem)
      : null;
  const genero = nomination.livro?.genero ?? null;

  return {
    id: nomination.id,
    cycle_id: nomination.cycle_id,
    titulo,
    autor,
    genero,
    imagem_url: imagemUrl,
    livro_id: nomination.livro_id,
    motivo: nomination.motivo,
    votes_count: votesCount,
    voted_by_me: votedByMe,
    indicado_por: {
      id: nomination.user.id,
      nome: nomination.user.nome,
      imagem_url: getImageUrl(req, nomination.user.imagem),
    },
    criado_em: nomination.criado_em?.toISOString() ?? null,
  };
}

async function countVotesForNomination(nominationId: number): Promise<number> {
  return AppDataSource.getRepository(BookClubVote).countBy({ nomination_id: nominationId });
}

async function getUserVotesInCycle(cycleId: number, userId: number): Promise<BookClubVote[]> {
  return AppDataSource.getRepository(BookClubVote).findBy({
    cycle_id: cycleId,
    user_id: userId,
  });
}

function pickWeightedWinner(
  nominations: BookClubNomination[],
  voteCounts: Map<number, number>
): number | null {
  if (nominations.length === 0) return null;

  const weights = nominations.map((n) => Math.max(1, voteCounts.get(n.id) ?? 0));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * total;

  for (let i = 0; i < nominations.length; i++) {
    random -= weights[i];
    if (random <= 0) return nominations[i].id;
  }

  return nominations[nominations.length - 1].id;
}

async function performDraw(cycle: BookClubCycle): Promise<BookClubNomination | null> {
  const nominationRepo = AppDataSource.getRepository(BookClubNomination);
  const cycleRepo = AppDataSource.getRepository(BookClubCycle);

  const nominations = await nominationRepo.find({
    where: { cycle_id: cycle.id },
    relations: ["user", "livro"],
  });

  if (nominations.length === 0) return null;

  const voteCounts = new Map<number, number>();
  for (const n of nominations) {
    voteCounts.set(n.id, await countVotesForNomination(n.id));
  }

  const winnerId = pickWeightedWinner(nominations, voteCounts);
  if (!winnerId) return null;

  cycle.status = "sorteado";
  cycle.data_sorteio = new Date();
  cycle.nomination_vencedora_id = winnerId;
  await cycleRepo.save(cycle);

  return nominations.find((n) => n.id === winnerId) ?? null;
}

async function getFeaturedBook(cycleId: number, req: Request) {
  const cycleRepo = AppDataSource.getRepository(BookClubCycle);
  const drawn = await cycleRepo.findOne({
    where: { status: "sorteado", book_club_id: cycleId },
    relations: ["nomination_vencedora", "nomination_vencedora.user", "nomination_vencedora.livro"],
    order: { data_sorteio: "DESC" },
  });

  if (!drawn?.nomination_vencedora) return null;

  const n = drawn.nomination_vencedora;
  const votes = await countVotesForNomination(n.id);

  return {
    cycle_titulo: drawn.titulo,
    data_sorteio: drawn.data_sorteio?.toISOString() ?? null,
    ...(await nominationPayload(n, votes, false, req)),
  };
}

// ─── GET / (Listar Clubes) ──────────────────────────────────────────────────
bookClubRouter.get("/", authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const search = ((req.query.search as string) || "").trim().toLowerCase();

    const clubRepo = AppDataSource.getRepository(BookClub);
    const memberRepo = AppDataSource.getRepository(BookClubMember);

    // Encontra todos os clubes onde o usuário é membro
    let myMemberships: BookClubMember[] = [];
    if (userId) {
      myMemberships = await memberRepo.find({
        where: { user_id: userId },
        relations: ["book_club"],
      });
    }

    const myClubIds = myMemberships.map((m) => m.book_club_id);

    // Query para buscar outros clubes públicos para explorar
    const queryBuilder = clubRepo.createQueryBuilder("c")
      .leftJoinAndSelect("c.criado_por", "criado_por");

    if (myClubIds.length > 0) {
      queryBuilder.where("c.id NOT IN (:...myClubIds)", { myClubIds });
      queryBuilder.andWhere("c.privado = false");
    } else {
      queryBuilder.where("c.privado = false");
    }

    if (search) {
      queryBuilder.andWhere("LOWER(c.nome) LIKE :search", { search: `%${search}%` });
    }

    const exploreClubs = await queryBuilder.getMany();

    const myClubsPayload = myMemberships.map((m) => ({
      id: m.book_club.id,
      nome: m.book_club.nome,
      descricao: m.book_club.descricao,
      imagem: m.book_club.imagem,
      privado: m.book_club.privado,
      convite_codigo: m.papel === "dono" || req.user?.papel === "admin" ? m.book_club.convite_codigo : null,
      criado_em: m.book_club.criado_em,
      is_member: true,
      membership_status: m.status,
      papel: m.papel,
    }));

    const explorePayload = exploreClubs.map((c) => ({
      id: c.id,
      nome: c.nome,
      descricao: c.descricao,
      imagem: c.imagem,
      privado: c.privado,
      convite_codigo: null,
      criado_em: c.criado_em,
      is_member: false,
      membership_status: null,
      papel: null,
    }));

    res.json({
      my_clubs: myClubsPayload,
      explore_clubs: explorePayload,
    });
  } catch (err) {
    console.error("List clubs error:", err);
    res.status(500).json({ message: "Erro ao listar clubes de livro" });
  }
});

// ─── POST / (Criar Clube) ───────────────────────────────────────────────────
bookClubRouter.post("/", authMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const { nome, descricao, privado } = req.body ?? {};
    if (!nome || typeof nome !== "string" || nome.trim().length === 0) {
      return res.status(400).json({ message: "Nome do clube é obrigatório" });
    }

    const userId = req.user!.id;
    const clubRepo = AppDataSource.getRepository(BookClub);
    const memberRepo = AppDataSource.getRepository(BookClubMember);

    const inviteCode = generateInviteCode();

    const club = clubRepo.create({
      nome: nome.trim(),
      descricao: descricao ? String(descricao).trim() : null,
      privado: !!privado,
      convite_codigo: inviteCode,
      criado_por_id: userId,
    });

    const savedClub = await clubRepo.save(club);

    // Adiciona o criador como dono do clube
    await memberRepo.save(
      memberRepo.create({
        book_club_id: savedClub.id,
        user_id: userId,
        papel: "dono",
        status: "active",
      })
    );

    res.status(201).json({
      id: savedClub.id,
      nome: savedClub.nome,
      descricao: savedClub.descricao,
      privado: savedClub.privado,
      convite_codigo: savedClub.convite_codigo,
      criado_em: savedClub.criado_em,
      is_member: true,
      membership_status: "active",
      papel: "dono",
    });
  } catch (err) {
    console.error("Create club error:", err);
    res.status(500).json({ message: "Erro ao criar clube de livro" });
  }
});

// ─── POST /join (Entrar ou solicitar entrada) ───────────────────────────────
bookClubRouter.post("/join", authMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const { club_id, convite_codigo } = req.body ?? {};
    const userId = req.user!.id;
    const clubRepo = AppDataSource.getRepository(BookClub);
    const memberRepo = AppDataSource.getRepository(BookClubMember);

    let club: BookClub | null = null;

    if (convite_codigo && String(convite_codigo).trim().length > 0) {
      club = await clubRepo.findOneBy({ convite_codigo: String(convite_codigo).trim().toUpperCase() });
      if (!club) {
        return res.status(404).json({ message: "Código de convite inválido" });
      }
    } else if (club_id) {
      club = await clubRepo.findOneBy({ id: parseInt(club_id) });
      if (!club) {
        return res.status(404).json({ message: "Clube do livro não encontrado" });
      }
    } else {
      return res.status(400).json({ message: "Informe o ID do clube ou o código de convite" });
    }

    // Verifica se já é membro ou tem solicitação pendente
    const existing = await memberRepo.findOneBy({ book_club_id: club.id, user_id: userId });
    if (existing) {
      if (existing.status === "active") {
        return res.status(400).json({ message: "Você já é membro deste clube" });
      } else {
        return res.status(400).json({ message: "Você já possui uma solicitação pendente para este clube" });
      }
    }

    let status = "active";
    // Se o clube for privado e NÃO for usado o código de convite (ou seja, tentou entrar direto pelo ID)
    if (club.privado && !convite_codigo) {
      status = "pending_approval";
    }

    const member = memberRepo.create({
      book_club_id: club.id,
      user_id: userId,
      papel: "membro",
      status: status,
    });

    await memberRepo.save(member);

    res.json({
      message: status === "active" ? "Você entrou no clube com sucesso" : "Solicitação de entrada enviada com sucesso",
      membership_status: status,
      club: {
        id: club.id,
        nome: club.nome,
        descricao: club.descricao,
        privado: club.privado,
      },
    });
  } catch (err) {
    console.error("Join club error:", err);
    res.status(500).json({ message: "Erro ao entrar no clube do livro" });
  }
});

// ─── GET /:clubId/members (Listar membros ativos) ───────────────────────────
bookClubRouter.get("/:clubId/members", authMiddleware(), checkClubMember, async (req: AuthRequest, res: Response) => {
  try {
    const clubId = parseInt(req.params.clubId);
    const memberRepo = AppDataSource.getRepository(BookClubMember);

    const members = await memberRepo.find({
      where: { book_club_id: clubId, status: "active" },
      relations: ["user"],
      order: { papel: "ASC", criado_em: "ASC" },
    });

    const payload = members.map((m) => ({
      id: m.id,
      user_id: m.user_id,
      papel: m.papel,
      allow_multiple_nominations: m.allow_multiple_nominations,
      criado_em: m.criado_em,
      user: {
        id: m.user.id,
        nome: m.user.nome,
        imagem_url: getImageUrl(req, m.user.imagem),
      },
    }));

    res.json(payload);
  } catch (err) {
    console.error("List members error:", err);
    res.status(500).json({ message: "Erro ao buscar membros do clube" });
  }
});

// ─── PUT /:clubId/members/:memberId/allow-multiple-nominations (Dono ou admin) ───────────
bookClubRouter.put(
  "/:clubId/members/:memberId/allow-multiple-nominations",
  authMiddleware(),
  checkClubOwner,
  async (req: AuthRequest, res: Response) => {
    try {
      const clubId = parseInt(req.params.clubId);
      const memberId = parseInt(req.params.memberId);
      const { allow_multiple_nominations } = req.body ?? {};
      if (typeof allow_multiple_nominations !== "boolean") {
        return res.status(400).json({ message: "Informe allow_multiple_nominations como booleano" });
      }

      const memberRepo = AppDataSource.getRepository(BookClubMember);
      const member = await memberRepo.findOne({
        where: { id: memberId, book_club_id: clubId, status: "active" },
        relations: ["user"],
      });
      if (!member) {
        return res.status(404).json({ message: "Membro não encontrado" });
      }
      if (member.papel === "dono") {
        return res.status(400).json({ message: "Não é possível alterar permissões do dono do clube" });
      }

      member.allow_multiple_nominations = allow_multiple_nominations;
      await memberRepo.save(member);

      res.json({
        id: member.id,
        user_id: member.user_id,
        papel: member.papel,
        allow_multiple_nominations: member.allow_multiple_nominations,
        criado_em: member.criado_em,
        user: {
          id: member.user.id,
          nome: member.user.nome,
          imagem_url: getImageUrl(req, member.user.imagem),
        },
      });
    } catch (err) {
      console.error("Update member nomination permission error:", err);
      res.status(500).json({ message: "Erro ao atualizar permissão de indicação" });
    }
  }
);

// ─── GET /:clubId/requests (Listar solicitações pendentes - Dono) ────────────
bookClubRouter.get("/:clubId/requests", authMiddleware(), checkClubOwner, async (req: AuthRequest, res: Response) => {
  try {
    const clubId = parseInt(req.params.clubId);
    const memberRepo = AppDataSource.getRepository(BookClubMember);

    const pending = await memberRepo.find({
      where: { book_club_id: clubId, status: "pending_approval" },
      relations: ["user"],
      order: { criado_em: "DESC" },
    });

    const payload = pending.map((p) => ({
      id: p.id,
      criado_em: p.criado_em,
      user: {
        id: p.user.id,
        nome: p.user.nome,
        email: p.user.email,
        imagem_url: getImageUrl(req, p.user.imagem),
      },
    }));

    res.json(payload);
  } catch (err) {
    console.error("List requests error:", err);
    res.status(500).json({ message: "Erro ao buscar solicitações pendentes" });
  }
});

// ─── POST /:clubId/requests/:requestId/approve (Aprovar solicitação) ─────────
bookClubRouter.post("/:clubId/requests/:requestId/approve", authMiddleware(), checkClubOwner, async (req: AuthRequest, res: Response) => {
  try {
    const clubId = parseInt(req.params.clubId);
    const requestId = parseInt(req.params.requestId);
    const memberRepo = AppDataSource.getRepository(BookClubMember);

    const request = await memberRepo.findOneBy({ id: requestId, book_club_id: clubId, status: "pending_approval" });
    if (!request) {
      return res.status(404).json({ message: "Solicitação não encontrada" });
    }

    request.status = "active";
    await memberRepo.save(request);

    res.json({ message: "Solicitação aprovada com sucesso!" });
  } catch (err) {
    console.error("Approve request error:", err);
    res.status(500).json({ message: "Erro ao aprovar solicitação" });
  }
});

// ─── POST /:clubId/requests/:requestId/reject (Rejeitar solicitação) ─────────
bookClubRouter.post("/:clubId/requests/:requestId/reject", authMiddleware(), checkClubOwner, async (req: AuthRequest, res: Response) => {
  try {
    const clubId = parseInt(req.params.clubId);
    const requestId = parseInt(req.params.requestId);
    const memberRepo = AppDataSource.getRepository(BookClubMember);

    const request = await memberRepo.findOneBy({ id: requestId, book_club_id: clubId, status: "pending_approval" });
    if (!request) {
      return res.status(404).json({ message: "Solicitação não encontrada" });
    }

    await memberRepo.remove(request);

    res.json({ message: "Solicitação rejeitada com sucesso" });
  } catch (err) {
    console.error("Reject request error:", err);
    res.status(500).json({ message: "Erro ao rejeitar solicitação" });
  }
});

// ─── POST /:clubId/invite (Adicionar membro diretamente pelo dono) ───────────
bookClubRouter.post("/:clubId/invite", authMiddleware(), checkClubOwner, async (req: AuthRequest, res: Response) => {
  try {
    const clubId = parseInt(req.params.clubId);
    const { user_id, email } = req.body ?? {};

    if (!user_id && !email) {
      return res.status(400).json({ message: "Informe user_id ou email do usuário" });
    }

    const userRepo = AppDataSource.getRepository(User);
    const memberRepo = AppDataSource.getRepository(BookClubMember);

    let targetUser: User | null = null;
    if (user_id) {
      targetUser = await userRepo.findOneBy({ id: parseInt(user_id) });
    } else {
      targetUser = await userRepo.findOneBy({ email: String(email).trim().toLowerCase() });
    }
    if (!targetUser) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    const existing = await memberRepo.findOneBy({ book_club_id: clubId, user_id: targetUser.id });
    if (existing) {
      if (existing.status === "active") {
        return res.status(400).json({ message: "Usuário já é membro deste clube" });
      } else {
        // Se estava pendente, já ativa diretamente
        existing.status = "active";
        await memberRepo.save(existing);
        return res.json({ message: "Usuário adicionado ao clube com sucesso" });
      }
    }

    await memberRepo.save(
      memberRepo.create({
        book_club_id: clubId,
        user_id: targetUser.id,
        papel: "membro",
        status: "active",
      })
    );

    res.json({ message: "Usuário adicionado ao clube com sucesso" });
  } catch (err) {
    console.error("Invite member error:", err);
    res.status(500).json({ message: "Erro ao convidar/adicionar membro" });
  }
});

// ─── GET /:clubId/hub ────────────────────────────────────────────────────────
bookClubRouter.get("/:clubId/hub", authMiddleware(true), checkClubMember, async (req: AuthRequest, res: Response) => {
  try {
    const clubId = parseInt(req.params.clubId);
    const cycle = await getOrCreateActiveCycle(clubId);
    const nominationRepo = AppDataSource.getRepository(BookClubNomination);
    const userId = req.user?.id ?? null;

    const club = await AppDataSource.getRepository(BookClub).findOneBy({ id: clubId });
    if (!club) return res.status(404).json({ message: "Clube não encontrado" });

    const nominations = await nominationRepo.find({
      where: { cycle_id: cycle.id },
      relations: ["user", "livro"],
      order: { criado_em: "DESC" },
    });

    const withVotes = await Promise.all(
      nominations.map(async (n) => {
        const votes = await countVotesForNomination(n.id);
        let votedByMe = false;
        if (userId) {
          const vote = await AppDataSource.getRepository(BookClubVote).findOneBy({
            cycle_id: cycle.id,
            nomination_id: n.id,
            user_id: userId,
          });
          votedByMe = vote !== null;
        }
        return { nomination: n, votes, votedByMe };
      })
    );

    withVotes.sort((a, b) => b.votes - a.votes);
    const preview = await Promise.all(
      withVotes.slice(0, 3).map(({ nomination, votes, votedByMe }) =>
        nominationPayload(nomination, votes, votedByMe, req)
      )
    );

    const member = userId
      ? await AppDataSource.getRepository(BookClubMember).findOneBy({ book_club_id: clubId, user_id: userId })
      : null;

    let userStats: any = null;
    if (userId) {
      const myVotes = await getUserVotesInCycle(cycle.id, userId);
      const myNomination = nominations.find((n) => n.user_id === userId);
      const allowMultiple = canNominateMore(member, req.user);
      userStats = {
        votes_used: myVotes.length,
        votes_remaining: MAX_VOTES_PER_CYCLE - myVotes.length,
        has_nominated: myNomination != null,
        can_nominate: allowMultiple || myNomination == null,
        my_nomination_id: myNomination?.id ?? null,
      };
    }

    const featured =
      cycle.status === "sorteado" && cycle.nomination_vencedora_id
        ? await (async () => {
            const winner = await nominationRepo.findOne({
              where: { id: cycle.nomination_vencedora_id! },
              relations: ["user", "livro"],
            });
            if (!winner) return null;
            const votes = await countVotesForNomination(winner.id);
            return {
              cycle_titulo: cycle.titulo,
              data_sorteio: cycle.data_sorteio?.toISOString() ?? null,
              ...(await nominationPayload(winner, votes, false, req)),
            };
          })()
        : await getFeaturedBook(clubId, req);

    // Busca dados adicionais do clube e papel do usuário
    let userRole: string | null = null;
    if (userId) {
      const mem = await AppDataSource.getRepository(BookClubMember).findOneBy({ book_club_id: clubId, user_id: userId });
      userRole = mem?.papel ?? null;
    }

    res.json({
      club: {
        id: club.id,
        nome: club.nome,
        descricao: club.descricao,
        privado: club.privado,
        convite_codigo: userRole === "dono" || req.user?.papel === "admin" ? club.convite_codigo : null,
        user_role: userRole,
      },
      cycle: {
        id: cycle.id,
        titulo: cycle.titulo,
        status: cycle.status,
        data_inicio: cycle.data_inicio.toISOString(),
        data_fim_votacao: cycle.data_fim_votacao.toISOString(),
        data_sorteio: cycle.data_sorteio?.toISOString() ?? null,
        dias_ate_sorteio: daysUntil(cycle.data_fim_votacao),
      },
      featured_book: featured,
      nominations_preview: preview,
      total_nominations: nominations.length,
      max_votes_per_user: MAX_VOTES_PER_CYCLE,
      user_stats: userStats,
    });
  } catch (err) {
    console.error("book-club hub error:", err);
    res.status(500).json({ message: "Erro ao carregar clube do livro" });
  }
});

// ─── GET /:clubId/nominations ────────────────────────────────────────────────
bookClubRouter.get(
  "/:clubId/nominations",
  authMiddleware(true),
  checkClubMember,
  async (req: AuthRequest, res: Response) => {
    try {
      const clubId = parseInt(req.params.clubId);
      const cycle = await getOrCreateActiveCycle(clubId);
      const search = ((req.query.search as string) || "").trim().toLowerCase();
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const perPage = Math.min(50, Math.max(1, parseInt(req.query.per_page as string) || 12));
      const userId = req.user?.id ?? null;

      const nominationRepo = AppDataSource.getRepository(BookClubNomination);
      let nominations = await nominationRepo.find({
        where: { cycle_id: cycle.id },
        relations: ["user", "livro"],
        order: { criado_em: "DESC" },
      });

      if (search) {
        nominations = nominations.filter((n) => {
          const titulo = (n.livro?.titulo ?? n.titulo ?? "").toLowerCase();
          const autor = (n.livro?.autor ?? n.autor ?? "").toLowerCase();
          return titulo.includes(search) || autor.includes(search);
        });
      }

      const withVotes = await Promise.all(
        nominations.map(async (n) => {
          const votes = await countVotesForNomination(n.id);
          let votedByMe = false;
          if (userId) {
            const vote = await AppDataSource.getRepository(BookClubVote).findOneBy({
              cycle_id: cycle.id,
              nomination_id: n.id,
              user_id: userId,
            });
            votedByMe = vote !== null;
          }
          return nominationPayload(n, votes, votedByMe, req);
        })
      );

      withVotes.sort((a, b) => b.votes_count - a.votes_count);

      const total = withVotes.length;
      const pages = Math.max(1, Math.ceil(total / perPage));
      const start = (page - 1) * perPage;
      const items = withVotes.slice(start, start + perPage);

      res.json({
        cycle: {
          id: cycle.id,
          titulo: cycle.titulo,
          status: cycle.status,
          data_fim_votacao: cycle.data_fim_votacao.toISOString(),
          dias_ate_sorteio: daysUntil(cycle.data_fim_votacao),
        },
        items,
        total,
        page,
        pages,
        max_votes_per_user: MAX_VOTES_PER_CYCLE,
      });
    } catch (err) {
      console.error("book-club nominations error:", err);
      res.status(500).json({ message: "Erro ao listar indicações" });
    }
  }
);

// ─── POST /:clubId/nominations ───────────────────────────────────────────────
bookClubRouter.post(
  "/:clubId/nominations",
  authMiddleware(),
  checkClubMember,
  upload.single("imagem"),
  async (req: AuthRequest, res: Response) => {
    try {
      const clubId = parseInt(req.params.clubId);
      const cycle = await getOrCreateActiveCycle(clubId);
      if (cycle.status === "sorteado" || cycle.status === "encerrado") {
        return res.status(400).json({ message: "O ciclo atual já foi encerrado" });
      }

      const { livro_id, titulo, autor, editora, editora_id, motivo } = req.body ?? {};
      const userId = req.user!.id;
      const nominationRepo = AppDataSource.getRepository(BookClubNomination);
      const memberRepo = AppDataSource.getRepository(BookClubMember);
      const member = await memberRepo.findOneBy({ book_club_id: clubId, user_id: userId });

      const existing = await nominationRepo.findOneBy({ cycle_id: cycle.id, user_id: userId });
      const allowMultiple = canNominateMore(member, req.user);
      if (existing && !allowMultiple) {
        return res.status(400).json({ message: "Você já indicou um livro neste ciclo" });
      }

      let livro: Livro | null = null;
      let tituloTrim: string | null = null;
      let autorTrim: string | null = null;
      if (livro_id) {
        livro = await AppDataSource.getRepository(Livro).findOneBy({ id: parseInt(livro_id) });
        if (!livro) {
          return res.status(404).json({ message: "Livro não encontrado" });
        }
      } else {
        tituloTrim = String(titulo ?? "").trim();
        autorTrim = String(autor ?? "").trim();
        if (!tituloTrim || !autorTrim) {
          return res.status(400).json({
            message: "Informe livro_id ou titulo e autor",
          });
        }

        livro = await findBookByTitleAndAuthor(tituloTrim, autorTrim);
      }

      if (livro?.id) {
        const duplicate = await nominationRepo.findOneBy({ cycle_id: cycle.id, livro_id: livro.id });
        if (duplicate) {
          return res.status(400).json({ message: "Este livro já foi indicado neste ciclo" });
        }
      } else if (!livro && tituloTrim && autorTrim) {
        const duplicate = await nominationRepo
          .createQueryBuilder("nomination")
          .where("nomination.cycle_id = :cycleId", { cycleId: cycle.id })
          .andWhere("LOWER(TRIM(nomination.titulo)) = :titulo", {
            titulo: normalizeText(tituloTrim),
          })
          .andWhere("LOWER(TRIM(nomination.autor)) = :autor", {
            autor: normalizeText(autorTrim),
          })
          .getOne();

        if (duplicate) {
          return res.status(400).json({ message: "Este livro já foi indicado neste ciclo" });
        }
      }

      let imagemPath: string | null = null;
      if (req.file) {
        const uploadFolder = livro || livro_id ? "book_club_nominations" : "books";
        imagemPath = await saveImage(req.file, uploadFolder);
        if (!imagemPath) {
          return res.status(400).json({ message: UNSUPPORTED_IMAGE_MESSAGE });
        }
      }

      if (!livro && !livro_id) {
        const livroRepo = AppDataSource.getRepository(Livro);
        const novoLivro = new Livro();
        novoLivro.submitted_by_id = userId;
        novoLivro.titulo = tituloTrim!;
        novoLivro.autor = autorTrim!;
        novoLivro.preco = "0.00";
        novoLivro.estoque = 0;
        novoLivro.paginas = 0;
        novoLivro.genero = null;
        novoLivro.condicao = "novo";
        novoLivro.descricao = null;
        novoLivro.imagem = imagemPath;
        novoLivro.isbn = null;
        novoLivro.open_library_key = null;
        novoLivro.editora_id = null;
        novoLivro.editor_id = null;

        const editoraId = editora_id ? parseInt(editora_id) : null;
        if (editoraId && !isNaN(editoraId)) {
          const editoraRepo = AppDataSource.getRepository(Editora);
          const existingEditora = await editoraRepo.findOneBy({ id: editoraId });
          if (!existingEditora) {
            return res.status(404).json({ message: "Editora não encontrada" });
          }
          novoLivro.editora_id = existingEditora.id;
        } else {
          const editoraTrim = String(editora ?? "").trim();
          if (editoraTrim) {
            const editoraRepo = AppDataSource.getRepository(Editora);
            const existingEditora = await editoraRepo.findOne({ where: { nome: editoraTrim } });
            if (existingEditora) {
              novoLivro.editora_id = existingEditora.id;
            } else {
              const novaEditora = editoraRepo.create({ nome: editoraTrim, imagem: null });
              const savedEditora = await editoraRepo.save(novaEditora);
              novoLivro.editora_id = savedEditora.id;
            }
          }
        }

        await AppDataSource.manager.transaction(async (manager) => {
          await manager.save(novoLivro);
          await syncAuthorsForBook(novoLivro.id, novoLivro.autor, manager);
        });

        livro = novoLivro;
      }

      const nomination = nominationRepo.create({
        cycle_id: cycle.id,
        user_id: userId,
        livro_id: livro?.id ?? null,
        titulo: livro ? null : tituloTrim,
        autor: livro ? null : autorTrim,
        motivo: motivo ? String(motivo).trim() : null,
        imagem: imagemPath,
      });

      const saved = await nominationRepo.save(nomination);
      const full = await nominationRepo.findOne({
        where: { id: saved.id },
        relations: ["user", "livro"],
      });

      res.status(201).json(await nominationPayload(full!, 0, false, req));
    } catch (err) {
      console.error("book-club nominate error:", err);
      res.status(500).json({ message: "Erro ao indicar livro" });
    }
  }
);

// ─── POST /:clubId/nominations/:id/vote ──────────────────────────────────────
bookClubRouter.post(
  "/:clubId/nominations/:id/vote",
  authMiddleware(),
  checkClubMember,
  async (req: AuthRequest, res: Response) => {
    try {
      const clubId = parseInt(req.params.clubId);
      const nominationId = parseInt(req.params.id);
      const userId = req.user!.id;
      const cycle = await getOrCreateActiveCycle(clubId);

      if (cycle.status === "sorteado" || cycle.status === "encerrado") {
        return res.status(400).json({ message: "A votação deste ciclo já encerrou" });
      }

      const nomination = await AppDataSource.getRepository(BookClubNomination).findOneBy({
        id: nominationId,
        cycle_id: cycle.id,
      });
      if (!nomination) {
        return res.status(404).json({ message: "Indicação não encontrada" });
      }

      const voteRepo = AppDataSource.getRepository(BookClubVote);
      const existing = await voteRepo.findOneBy({
        cycle_id: cycle.id,
        nomination_id: nominationId,
        user_id: userId,
      });

      if (existing) {
        await voteRepo.remove(existing);
        const votesCount = await countVotesForNomination(nominationId);
        return res.json({
          voted: false,
          votes_count: votesCount,
          votes_remaining: MAX_VOTES_PER_CYCLE - (await getUserVotesInCycle(cycle.id, userId)).length,
        });
      }

      const myVotes = await getUserVotesInCycle(cycle.id, userId);
      if (myVotes.length >= MAX_VOTES_PER_CYCLE) {
        return res.status(400).json({
          message: `Você já usou seus ${MAX_VOTES_PER_CYCLE} votos neste ciclo`,
        });
      }

      await voteRepo.save(
        voteRepo.create({
          cycle_id: cycle.id,
          nomination_id: nominationId,
          user_id: userId,
        })
      );

      const votesCount = await countVotesForNomination(nominationId);
      res.json({
        voted: true,
        votes_count: votesCount,
        votes_remaining: MAX_VOTES_PER_CYCLE - (await getUserVotesInCycle(cycle.id, userId)).length,
      });
    } catch (err) {
      console.error("book-club vote error:", err);
      res.status(500).json({ message: "Erro ao registrar voto" });
    }
  }
);

// ─── DELETE /:clubId/nominations/:id (admin ou dono) ──────────────────────────
bookClubRouter.delete(
  "/:clubId/nominations/:id",
  authMiddleware(),
  checkClubOwner,
  async (req: AuthRequest, res: Response) => {
    try {
      const clubId = parseInt(req.params.clubId);
      const nominationId = parseInt(req.params.id);

      const nomination = await AppDataSource.getRepository(BookClubNomination).findOne({
        where: { id: nominationId, cycle_id: (await getOrCreateActiveCycle(clubId)).id },
      });

      if (!nomination) {
        return res.status(404).json({ message: "Indicação não encontrada" });
      }

      await AppDataSource.getRepository(BookClubNomination).remove(nomination);

      res.json({ message: "Indicação removida com sucesso" });
    } catch (err) {
      console.error("book-club delete nomination error:", err);
      res.status(500).json({ message: "Erro ao remover indicação" });
    }
  }
);

// ─── GET /:clubId/activity ───────────────────────────────────────────────────
bookClubRouter.get("/:clubId/activity", authMiddleware(true), checkClubMember, async (req: AuthRequest, res: Response) => {
  try {
    const clubId = parseInt(req.params.clubId);
    const cycle = await getOrCreateActiveCycle(clubId);
    const activities: Array<{
      tipo: string;
      user_nome: string;
      livro_titulo: string;
      criado_em: string;
    }> = [];

    const votes = await AppDataSource.getRepository(BookClubVote)
      .createQueryBuilder("v")
      .leftJoinAndSelect("v.user", "user")
      .leftJoinAndSelect("v.nomination", "nomination")
      .leftJoinAndSelect("nomination.livro", "livro")
      .where("v.cycle_id = :cycleId", { cycleId: cycle.id })
      .orderBy("v.criado_em", "DESC")
      .take(10)
      .getMany();

    for (const v of votes) {
      activities.push({
        tipo: "voto",
        user_nome: v.user.nome,
        livro_titulo: v.nomination.livro?.titulo ?? v.nomination.titulo ?? "Livro",
        criado_em: v.criado_em.toISOString(),
      });
    }

    const nominations = await AppDataSource.getRepository(BookClubNomination)
      .createQueryBuilder("n")
      .leftJoinAndSelect("n.user", "user")
      .leftJoinAndSelect("n.livro", "livro")
      .where("n.cycle_id = :cycleId", { cycleId: cycle.id })
      .orderBy("n.criado_em", "DESC")
      .take(10)
      .getMany();

    for (const n of nominations) {
      activities.push({
        tipo: "indicacao",
        user_nome: n.user.nome,
        livro_titulo: n.livro?.titulo ?? n.titulo ?? "Livro",
        criado_em: n.criado_em.toISOString(),
      });
    }

    activities.sort((a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime());

    res.json({ items: activities.slice(0, 15) });
  } catch (err) {
    console.error("book-club activity error:", err);
    res.status(500).json({ message: "Erro ao carregar atividade" });
  }
});

// ─── POST /:clubId/draw (dono ou admin) ──────────────────────────────────────
bookClubRouter.post(
  "/:clubId/draw",
  authMiddleware(),
  checkClubOwner,
  async (req: AuthRequest, res: Response) => {
    try {
      const clubId = parseInt(req.params.clubId);
      const cycle = await getOrCreateActiveCycle(clubId);
      if (cycle.status === "sorteado") {
        return res.status(400).json({ message: "O sorteio deste ciclo já foi realizado" });
      }

      const winner = await performDraw(cycle);
      if (!winner) {
        return res.status(400).json({ message: "Não há indicações para sortear" });
      }

      res.json({
        message: "Sorteio realizado com sucesso",
        vencedor: {
          id: winner.id,
          titulo: winner.livro?.titulo ?? winner.titulo,
          autor: winner.livro?.autor ?? winner.autor,
        },
      });
    } catch (err) {
      console.error("book-club draw error:", err);
      res.status(500).json({ message: "Erro ao realizar sorteio" });
    }
  }
);

// ─── POST /:clubId/cycle (dono ou admin — inicia novo ciclo) ─────────────────
bookClubRouter.post(
  "/:clubId/cycle",
  authMiddleware(),
  checkClubOwner,
  async (req: AuthRequest, res: Response) => {
    try {
      const clubId = parseInt(req.params.clubId);
      const repo = AppDataSource.getRepository(BookClubCycle);
      const active = await repo.findOne({
        where: [
          { book_club_id: clubId, status: "nominacao" },
          { book_club_id: clubId, status: "votacao" },
        ],
      });

      if (active) {
        active.status = "encerrado";
        await repo.save(active);
      }

      const now = new Date();
      const cycle = await repo.save(
        repo.create({
          book_club_id: clubId,
          titulo: cycleTitle(now),
          status: "votacao",
          data_inicio: now,
          data_fim_votacao: endOfMonth(now),
        })
      );

      res.status(201).json({
        id: cycle.id,
        titulo: cycle.titulo,
        status: cycle.status,
      });
    } catch (err) {
      console.error("book-club new cycle error:", err);
      res.status(500).json({ message: "Erro ao criar ciclo" });
    }
  }
);
