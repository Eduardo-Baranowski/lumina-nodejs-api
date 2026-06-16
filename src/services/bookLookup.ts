import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

const ISBN_API_BASE = "https://api.isbn.gov.br/books";
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

// ─── ISBN Brasil API (Official Brazilian Government API) ─────────────────
// Source: https://www.isbn.gov.br/website/consulta-api
// Note: This is the official Brazilian government API maintained by Fundação Biblioteca Nacional
// It provides the most accurate data for Brazilian book publications including publisher info
// If unavailable, automatically falls back to Open Library

const normalizeIsbnResult = (book: any): any | null => {
  const titulo = (book.title || "").trim();
  if (!titulo) return null;

  const autores = book.authors || [];
  const autor = Array.isArray(autores)
    ? autores.map((a: any) => (typeof a === "string" ? a : a.name)).filter(Boolean).join(", ") || "Autor desconhecido"
    : "Autor desconhecido";

  const editora = book.publisher?.name || book.publisher || null;
  const isbn = book.isbn || null;
  const ano = book.publish_date ? new Date(book.publish_date).getFullYear() : null;

  // ISBN API pode ter cover em diferentes formatos
  let imagemUrl: string | null = null;
  if (book.image_url) {
    imagemUrl = book.image_url;
  } else if (isbn) {
    // Fallback: try to fetch from Open Library using ISBN
    imagemUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
  }

  return {
    titulo,
    autor,
    editora,
    descricao: book.description || null,
    genero: book.category ? mapGenre([book.category]) : null,
    ano,
    isbn,
    imagem_url: imagemUrl,
    fonte: "isbn_brasil",
    cover_id: null, // ISBN API não usa cover_id como Open Library
  };
};

const searchBooksIsbnBrasil = async (query: string, limit = 8): Promise<any[]> => {
  const q = (query || "").trim();
  if (q.length < 2) return [];

  const TIMEOUT_MS = 5000; // 5 segundos - mais curto pois é fallback
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // ISBN Brasil tem dois tipos de buscas:
    // 1. Por ISBN direto: GET /books/{isbn}
    // 2. Por query: GET /books?query=...
    
    // Vamos tentar como query genérica
    const url = new URL(ISBN_API_BASE);
    url.searchParams.append("query", q);
    url.searchParams.append("limit", String(Math.min(limit, 10)));

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { "Accept": "application/json" },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[ISBN Brasil] API returned status ${response.status}`);
      return [];
    }

    const data = (await response.json()) as any;
    const books = Array.isArray(data) ? data : data.books || data.items || [];

    if (!Array.isArray(books)) {
      return [];
    }

    const results: any[] = [];
    const seen = new Set<string>();

    for (const book of books) {
      const item = normalizeIsbnResult(book);
      if (!item) continue;

      const key = `${item.titulo.toLowerCase()}|||${item.autor.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push(item);
    }

    return results;
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isTimeout = err?.name === "AbortError" || err?.code === "ECONNABORTED";
    if (!isTimeout) {
      console.warn(`[ISBN Brasil] Search failed (will fallback to Open Library): ${err?.message ?? err}`);
    }
    return []; // Return empty array to trigger fallback
  }
};

// ─── Open Library API (Fallback) ─────────────────────────────────────────

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

  // Extract publisher info from Open Library if available
  const editora = doc.publisher && Array.isArray(doc.publisher) 
    ? doc.publisher[0] 
    : doc.publisher || null;

  return {
    titulo: title,
    autor: autor,
    editora: editora,
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

  // ─── Step 1: Try ISBN Brasil (National Priority) ───────────────────────
  console.log(`[bookLookup] Searching "${q}" in ISBN Brasil...`);
  const isbnResults = await searchBooksIsbnBrasil(q, Math.ceil(limit / 2));
  
  if (isbnResults.length > 0) {
    console.log(`[bookLookup] Found ${isbnResults.length} results in ISBN Brasil`);
    // If we got good results, return them and maybe add Open Library to fill quota
    if (isbnResults.length >= limit) {
      return isbnResults.slice(0, limit);
    }
    // Pad with Open Library if needed
    const remainingQuota = limit - isbnResults.length;
    try {
      const olResults = await searchBooksOpenLibrary(q, remainingQuota);
      return [...isbnResults, ...olResults];
    } catch {
      // If Open Library fails, just return ISBN results
      return isbnResults;
    }
  }

  // ─── Step 2: Fallback to Open Library ────────────────────────────────
  console.log(`[bookLookup] ISBN Brasil returned no results, trying Open Library...`);
  return searchBooksOpenLibrary(q, limit);
};

// ─── Open Library Search (extracted for reuse) ─────────────────────────

const searchBooksOpenLibrary = async (query: string, limit = 8): Promise<any[]> => {
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

  const MAX_ATTEMPTS = 2;
  const TIMEOUT_MS = 8000; // 8 segundos por tentativa

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
    } catch (err: any) {
      clearTimeout(timeoutId);
      lastErr = err;
      const isTimeout = err?.name === "AbortError" || err?.code === "ECONNABORTED";
      console.error(
        `[bookLookup] Tentativa ${attempt}/${MAX_ATTEMPTS} falhou${isTimeout ? " (timeout)" : ""}: ${err?.message ?? err}`
      );
      if (!isTimeout || attempt >= MAX_ATTEMPTS) {
        throw err;
      }
      // Pequena pausa antes de tentar novamente
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  throw lastErr;
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
