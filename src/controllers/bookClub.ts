import { Router, Response, Request } from "express";
import { AppDataSource } from "../config/database";
import { BookClubCycle } from "../entities/BookClubCycle";
import { BookClubNomination } from "../entities/BookClubNomination";
import { BookClubVote } from "../entities/BookClubVote";
import { Livro } from "../entities/Livro";
import { AuthRequest, authMiddleware, requireRole } from "../middlewares/auth";
import { getImageUrl } from "../utils/image";

export const bookClubRouter = Router();

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

function cycleTitle(date: Date): string {
  return `${MONTHS_PT[date.getMonth()]} ${date.getFullYear()}`;
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 18, 0, 0);
}

function daysUntil(target: Date): number {
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

async function getOrCreateActiveCycle(): Promise<BookClubCycle> {
  const repo = AppDataSource.getRepository(BookClubCycle);
  let cycle = await repo.findOne({
    where: [{ status: "nominacao" }, { status: "votacao" }],
    order: { data_inicio: "DESC" },
  });

  if (cycle) return cycle;

  const now = new Date();
  cycle = repo.create({
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
  const imagemUrl = nomination.livro?.imagem
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

async function getFeaturedBook(req: Request) {
  const cycleRepo = AppDataSource.getRepository(BookClubCycle);
  const drawn = await cycleRepo.findOne({
    where: { status: "sorteado" },
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

// ─── GET /hub ────────────────────────────────────────────────────────────────
bookClubRouter.get("/hub", authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const cycle = await getOrCreateActiveCycle();
    const nominationRepo = AppDataSource.getRepository(BookClubNomination);
    const userId = req.user?.id ?? null;

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

    let userStats = null;
    if (userId) {
      const myVotes = await getUserVotesInCycle(cycle.id, userId);
      const myNomination = nominations.find((n) => n.user_id === userId);
      userStats = {
        votes_used: myVotes.length,
        votes_remaining: MAX_VOTES_PER_CYCLE - myVotes.length,
        has_nominated: myNomination != null,
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
        : await getFeaturedBook(req);

    res.json({
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

// ─── GET /nominations ────────────────────────────────────────────────────────
bookClubRouter.get(
  "/nominations",
  authMiddleware(true),
  async (req: AuthRequest, res: Response) => {
    try {
      const cycle = await getOrCreateActiveCycle();
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

// ─── POST /nominations ───────────────────────────────────────────────────────
bookClubRouter.post(
  "/nominations",
  authMiddleware(),
  async (req: AuthRequest, res: Response) => {
    try {
      const cycle = await getOrCreateActiveCycle();
      if (cycle.status === "sorteado" || cycle.status === "encerrado") {
        return res.status(400).json({ message: "O ciclo atual já foi encerrado" });
      }

      const { livro_id, titulo, autor, motivo } = req.body ?? {};
      const userId = req.user!.id;
      const nominationRepo = AppDataSource.getRepository(BookClubNomination);

      const existing = await nominationRepo.findOneBy({ cycle_id: cycle.id, user_id: userId });
      if (existing) {
        return res.status(400).json({ message: "Você já indicou um livro neste ciclo" });
      }

      let livro: Livro | null = null;
      if (livro_id) {
        livro = await AppDataSource.getRepository(Livro).findOneBy({ id: parseInt(livro_id) });
        if (!livro) {
          return res.status(404).json({ message: "Livro não encontrado" });
        }
      } else {
        const tituloTrim = (titulo as string)?.trim();
        const autorTrim = (autor as string)?.trim();
        if (!tituloTrim || !autorTrim) {
          return res.status(400).json({
            message: "Informe livro_id ou titulo e autor",
          });
        }
      }

      const duplicateQuery = nominationRepo
        .createQueryBuilder("n")
        .leftJoinAndSelect("n.livro", "livro")
        .where("n.cycle_id = :cycleId", { cycleId: cycle.id });

      if (livro) {
        duplicateQuery.andWhere("n.livro_id = :livroId", { livroId: livro.id });
      } else {
        duplicateQuery.andWhere("LOWER(COALESCE(n.titulo, '')) = LOWER(:titulo)", {
          titulo: (titulo as string).trim(),
        });
      }

      const duplicate = await duplicateQuery.getOne();
      if (duplicate) {
        return res.status(400).json({ message: "Este livro já foi indicado neste ciclo" });
      }

      const nomination = nominationRepo.create({
        cycle_id: cycle.id,
        user_id: userId,
        livro_id: livro?.id ?? null,
        titulo: livro ? null : (titulo as string).trim(),
        autor: livro ? null : (autor as string).trim(),
        motivo: motivo ? String(motivo).trim() : null,
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

// ─── POST /nominations/:id/vote ──────────────────────────────────────────────
bookClubRouter.post(
  "/nominations/:id/vote",
  authMiddleware(),
  async (req: AuthRequest, res: Response) => {
    try {
      const nominationId = parseInt(req.params.id);
      const userId = req.user!.id;
      const cycle = await getOrCreateActiveCycle();

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

// ─── GET /activity ───────────────────────────────────────────────────────────
bookClubRouter.get("/activity", authMiddleware(true), async (_req: AuthRequest, res: Response) => {
  try {
    const cycle = await getOrCreateActiveCycle();
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

// ─── POST /draw (admin) ──────────────────────────────────────────────────────
bookClubRouter.post(
  "/draw",
  authMiddleware(),
  requireRole("admin"),
  async (_req: AuthRequest, res: Response) => {
    try {
      const cycle = await getOrCreateActiveCycle();
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

// ─── POST /cycle (admin — inicia novo ciclo) ─────────────────────────────────
bookClubRouter.post(
  "/cycle",
  authMiddleware(),
  requireRole("admin"),
  async (_req: AuthRequest, res: Response) => {
    try {
      const repo = AppDataSource.getRepository(BookClubCycle);
      const active = await repo.findOne({
        where: [{ status: "nominacao" }, { status: "votacao" }],
      });

      if (active) {
        active.status = "encerrado";
        await repo.save(active);
      }

      const now = new Date();
      const cycle = await repo.save(
        repo.create({
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
