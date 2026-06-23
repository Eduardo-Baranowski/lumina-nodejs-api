import * as crypto from "crypto";
import { EntityManager } from "typeorm";
import { AppDataSource } from "../config/database";
import { Autor } from "../entities/Autor";
import { LivroAutor } from "../entities/LivroAutor";
import { Livro } from "../entities/Livro";

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

export const findOrCreateAutor = async (
  manager: EntityManager,
  nome: string,
  openLibraryKey?: string | null
): Promise<Autor> => {
  const trimmed = nome.trim();
  const existing = await manager
    .getRepository(Autor)
    .createQueryBuilder("autor")
    .where("LOWER(autor.nome) = LOWER(:nome)", { nome: trimmed })
    .getOne();

  if (existing) {
    if (openLibraryKey && !existing.open_library_key) {
      existing.open_library_key = openLibraryKey;
      await manager.save(existing);
    }
    return existing;
  }

  const autor = manager.create(Autor, {
    nome: trimmed,
    slug: slugifyAuthorName(trimmed),
    open_library_key: openLibraryKey || null,
  });
  return manager.save(autor);
};

export const syncAuthorsForBook = async (
  livroId: number,
  autorRaw: string,
  manager?: EntityManager
): Promise<void> => {
  const em = manager || AppDataSource.manager;
  const names = parseAuthorNames(autorRaw);
  if (names.length === 0) return;

  await em.delete(LivroAutor, { livro_id: livroId });

  for (let i = 0; i < names.length; i++) {
    const autor = await findOrCreateAutor(em, names[i]);
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
  const result = await AppDataSource.manager.query(
    `
    SELECT
      (SELECT COUNT(*)::int FROM livro_autor la WHERE la.autor_id = $1) AS total_livros,
      (SELECT COUNT(DISTINCT le.id)::int
         FROM leitura le
         JOIN livro_autor la ON la.livro_id = le.livro_id
        WHERE la.autor_id = $1) AS total_leituras
    `,
    [autorId]
  );
  return {
    total_livros: result[0]?.total_livros ?? 0,
    total_leituras: result[0]?.total_leituras ?? 0,
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
