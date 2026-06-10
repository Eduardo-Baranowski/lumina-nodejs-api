import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

const OPEN_LIBRARY_SEARCH = "https://openlibrary.org/search.json";
const OPEN_LIBRARY_COVER = "https://covers.openlibrary.org/b/id/{cover_id}-{size}.jpg";

const SUBJECT_GENRE_RULES: [string, string[]][] = [
  ["Mistério", ["mystery", "detective", "crime", "thriller", "suspense"]],
  ["Ficção Científica", ["science fiction", "sci-fi", "ficção científica"]],
  ["Fantasia", ["fantasy", "fantasia", "magic", "dragons"]],
  ["Terror", ["horror", "terror", "ghost", "vampire"]],
  ["História", ["history", "historical", "história", "world war"]],
  ["Biografia", ["biography", "autobiography", "memoir"]],
  ["Autoajuda", ["self-help", "self help", "personal growth", "motivation"]],
  ["Técnico", ["computers", "programming", "software", "algorithms", "engineering"]],
  ["Infantil", ["juvenile", "children", "infantil", "young adult"]],
  ["Romance", ["romance", "love stories", "fiction, romance"]],
];

export const getCoverUrl = (coverId: number | null, size = "M"): string | null => {
  if (!coverId) return null;
  return OPEN_LIBRARY_COVER.replace("{cover_id}", String(coverId)).replace("{size}", size);
};

export const mapGenre = (subjects: string[] | null): string | null => {
  if (!subjects || subjects.length === 0) return null;
  const haystack = subjects.join(" ").toLowerCase();
  for (const [genre, keywords] of SUBJECT_GENRE_RULES) {
    if (keywords.some((kw) => haystack.includes(kw))) {
      return genre;
    }
  }
  return null;
};

const getFirstSentence = (doc: any): string | null => {
  const raw = doc.first_sentence;
  if (Array.isArray(raw) && raw.length > 0) {
    return String(raw[0]).trim();
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  return null;
};

const normalizeDoc = (doc: any): any | null => {
  const title = (doc.title || "").trim();
  if (!title) return null;

  const authors = doc.author_name || [];
  const autor = authors.filter((a) => a).join(", ").trim() || "Autor desconhecido";

  const coverId = doc.cover_i;
  let subjects = doc.subject || [];
  if (typeof subjects === "string") {
    subjects = [subjects];
  }

  const isbnList = doc.isbn || [];
  const isbn = isbnList.length > 0 ? String(isbnList[0]) : null;

  return {
    titulo: title,
    autor: autor,
    descricao: getFirstSentence(doc),
    genero: mapGenre(subjects),
    ano: doc.first_publish_year,
    isbn: isbn,
    cover_id: coverId ? parseInt(coverId) : null,
    imagem_url: coverId ? getCoverUrl(parseInt(coverId)) : null,
    fonte: "open_library",
    open_library_key: doc.key,
  };
};

export const searchBooks = async (query: string, limit = 8): Promise<any[]> => {
  const q = (query || "").trim();
  if (q.length < 2) return [];

  const maxLimit = Math.max(1, Math.min(limit, 15));

  const url = new URL(OPEN_LIBRARY_SEARCH);
  url.searchParams.append("q", q);
  url.searchParams.append("limit", String(maxLimit));
  url.searchParams.append(
    "fields",
    "key,title,author_name,first_publish_year,cover_i,subject,isbn,first_sentence"
  );

  // 15 seconds timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Open Library returned status ${response.status}`);
    }

    const data = (await response.json()) as any;
    const docs = data.docs || [];

    const results: any[] = [];
    const seen = new Set<string>();

    for (const doc of docs) {
      const item = normalizeDoc(doc);
      if (!item) continue;

      const key = `${item.titulo.toLowerCase()}|||${item.autor.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push(item);
    }

    return results;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("Error searching books in Open Library:", err);
    throw err;
  }
};

export const downloadCoverToUploads = async (
  coverId: number,
  uploadFolder: string
): Promise<string | null> => {
  const url = getCoverUrl(coverId, "L");
  if (!url) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    // Open Library returns small placeholders for missing covers (often < 500 bytes)
    if (buffer.length < 500) {
      return null;
    }

    const booksDir = path.join(uploadFolder, "books");
    fs.mkdirSync(booksDir, { recursive: true });

    const filename = `${uuidv4().replace(/-/g, "")}.jpg`;
    const targetPath = path.join(booksDir, filename);

    fs.writeFileSync(targetPath, buffer);

    return path.join("books", filename);
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("Error downloading book cover:", err);
    return null;
  }
};
