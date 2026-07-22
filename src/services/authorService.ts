import * as crypto from "crypto";
import { EntityManager } from "typeorm";
import { AppDataSource } from "../config/database";
import { Autor } from "../entities/Autor";
import { LivroAutor } from "../entities/LivroAutor";
import { Livro } from "../entities/Livro";
import { Leitura } from "../entities/Leitura";
import { Nacionalidade } from "../entities/Nacionalidade";

export const slugifyAuthorName = (nome: string): string => {
  const base = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const hash = crypto.createHash("md5").update(nome.toLowerCase()).digest("hex").slice(0, 6);
  return `${base || "autor"}-${hash}`;
};

export const parseAuthorNames = (autorRaw: string): string[] => {
  const normalized = (autorRaw || "")
    .replace(/\s+e\s+/gi, ", ")
    .replace(/\s+&\s+/g, ", ");
  return normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
};

export const buildBookAuthorPayload = (book: { autor?: string | null; autores?: Array<{ id: number; nome: string }> | null }) => ({
  autor: (book.autores && book.autores.length > 0 ? book.autores.map((a) => a.nome).join(", ") : book.autor) || "Autor desconhecido",
  autores: (book.autores || []).map((a) => ({ id: a.id, nome: a.nome })),
});

export const getAllNationalities = async (): Promise<Nacionalidade[]> => {
  return AppDataSource.getRepository(Nacionalidade).find({ order: { nome: "ASC" } });
};

export const nationalityExists = async (nome: string): Promise<boolean> => {
  const normalized = String(nome || "").trim();
  if (!normalized) return false;
  const count = await AppDataSource.getRepository(Nacionalidade)
    .createQueryBuilder("n")
    .where("n.nome = :nome", { nome: normalized })
    .getCount();
  return count > 0;
};

export const findOrCreateAutor = async (
  manager: EntityManager,
  nome: string,
  openLibraryKey?: string | null,
  nacionalidade?: string | null
): Promise<Autor> => {
  const trimmed = nome.trim();
  const existing = await manager
    .getRepository(Autor)
    .createQueryBuilder("autor")
    .where("LOWER(autor.nome) = LOWER(:nome)", { nome: trimmed })
    .getOne();

  if (existing) {
    let changed = false;
    if (openLibraryKey && !existing.open_library_key) {
      existing.open_library_key = openLibraryKey;
      changed = true;
    }
    if (nacionalidade && !existing.nacionalidade) {
      existing.nacionalidade = nacionalidade;
      changed = true;
    }
    if (changed) await manager.save(existing);
    return existing;
  }

  const autor = manager.create(Autor, {
    nome: trimmed,
    slug: slugifyAuthorName(trimmed),
    open_library_key: openLibraryKey || null,
    nacionalidade: nacionalidade || null,
  });
  return manager.save(autor);
};

export const syncAuthorsForBook = async (
  livroId: number,
  autorRaw: string,
  manager?: EntityManager,
  nacionalidade?: string | null
): Promise<void> => {
  const em = manager || AppDataSource.manager;
  const names = parseAuthorNames(autorRaw);
  if (names.length === 0) return;

  await em.delete(LivroAutor, { livro_id: livroId });

  for (let i = 0; i < names.length; i++) {
    const autor = await findOrCreateAutor(em, names[i], undefined, nacionalidade || null);
    const link = em.create(LivroAutor, {
      livro_id: livroId,
      autor_id: autor.id,
      ordem: i,
    });
    await em.save(link);
  }
};

export const getAuthorsForBook = async (livroId: number): Promise<Autor[]> => {
  const links = await AppDataSource.getRepository(LivroAutor).find({
    where: { livro_id: livroId },
    relations: ["autor"],
    order: { ordem: "ASC" },
  });
  return links.map((l) => l.autor).filter(Boolean);
};

export const formatAuthorsDisplay = (autores: Autor[]): string => {
  if (autores.length === 0) return "Autor desconhecido";
  return autores.map((a) => a.nome).join(", ");
};

export const getAuthorStats = async (autorId: number) => {
  const livroAutorRepository = AppDataSource.getRepository(LivroAutor);
  const leituraRepository = AppDataSource.getRepository(Leitura);

  const bookLinks = await livroAutorRepository.find({
    where: { autor_id: autorId },
    select: ["livro_id"],
  });

  const livroIds = bookLinks.map((link) => link.livro_id);
  const total_livros = livroIds.length;

  let total_leituras = 0;
  if (livroIds.length > 0) {
    total_leituras = await leituraRepository
      .createQueryBuilder("leitura")
      .where("leitura.livro_id IN (:...livroIds)", { livroIds })
      .getCount();
  }

  return {
    total_livros,
    total_leituras,
  };
};

export const findBookByIsbn = async (isbn: string): Promise<Livro | null> => {
  const normalized = isbn.replace(/[-\s]/g, "");
  if (!normalized) return null;
  return AppDataSource.getRepository(Livro)
    .createQueryBuilder("livro")
    .where("REPLACE(REPLACE(livro.isbn, '-', ''), ' ', '') = :isbn", { isbn: normalized })
    .getOne();
};
