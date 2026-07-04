import fs from "node:fs";

const API_BASE = process.env.LUMINA_API_BASE || "https://lumina-nodejs-api.vercel.app";
const EMAIL = process.env.LUMINA_EMAIL;
const PASSWORD = process.env.LUMINA_PASSWORD;
const SOURCE_FILE = process.env.SKOOK_SOURCE_FILE
  || "/home/ebaranowski/.codex/attachments/7d4fe45b-beb1-4764-94f8-c324a6967242/pasted-text.txt";

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&#769;/g, "")
    .replace(/&/g, " e ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function compactTitle(value) {
  return normalize(value)
    .replace(/\bcolecao\b/g, "")
    .replace(/\bclassicos\b/g, "")
    .replace(/\bzahar\b/g, "")
    .replace(/\bobra prima de cada autor\b/g, "")
    .replace(/\bbox\b/g, "")
    .replace(/\bvolume\b/g, "")
    .replace(/\bvol\b/g, "")
    .replace(/\b\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sameBook(a, b) {
  return compactTitle(a.title || a.titulo) === compactTitle(b.title || b.titulo)
    && normalize(a.author || a.autor).includes(normalize(b.author || b.autor).split(" ").at(-1) || "__")
      ? true
      : compactTitle(a.title || a.titulo) === compactTitle(b.title || b.titulo)
        && normalize(b.author || b.autor).includes(normalize(a.author || a.autor).split(" ").at(-1) || "__");
}

function nextNonEmpty(lines, idx) {
  let j = idx;
  while (j < lines.length && !lines[j]) j += 1;
  return j;
}

function parseSkookFile(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim());
  const consumed = new Set();
  const entries = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes("Capa do livro ")) continue;
    let j = nextNonEmpty(lines, i + 1);
    const title = lines[j];
    j = nextNonEmpty(lines, j + 1);
    const author = lines[j];
    j = nextNonEmpty(lines, j + 1);
    const publisher = lines[j];
    j = nextNonEmpty(lines, j + 1);
    const pagesLine = lines[j];
    if (!title || !author || !publisher || !/páginas/i.test(pagesLine || "")) continue;
    j = nextNonEmpty(lines, j + 1);
    let rating = null;
    if (/^\d+(?:[.,]\d+)?$/.test(lines[j] || "")) {
      rating = parseFloat(lines[j].replace(",", "."));
      j = nextNonEmpty(lines, j + 1);
    }
    const progress = (lines[j] || "").match(/(\d+)%/)?.[1] ?? null;
    entries.push({
      title,
      author,
      publisher,
      pages: parseInt(pagesLine, 10),
      rating,
      progress: progress ? parseInt(progress, 10) : null,
      line: i + 1,
    });
    for (let k = i; k <= j; k += 1) consumed.add(k);
  }

  for (let i = 0; i < lines.length - 3; i += 1) {
    if (consumed.has(i) || !lines[i] || lines[i].startsWith("Todos") || lines[i].startsWith("seguinte")) continue;
    const j1 = nextNonEmpty(lines, i + 1);
    const j2 = nextNonEmpty(lines, j1 + 1);
    const j3 = nextNonEmpty(lines, j2 + 1);
    if (j1 !== i + 1 || j2 !== i + 2 || j3 !== i + 3) continue;
    if (!/páginas/i.test(lines[j3] || "")) continue;
    if (/^\d+(?:[.,]\d+)?$/.test(lines[i]) || /^(\d+)%/.test(lines[i])) continue;
    const title = lines[i];
    const author = lines[j1];
    const publisher = lines[j2];
    if (entries.some((entry) => entry.title === title && entry.author === author)) continue;
    let j = nextNonEmpty(lines, j3 + 1);
    let rating = null;
    if (/^\d+(?:[.,]\d+)?$/.test(lines[j] || "")) {
      rating = parseFloat(lines[j].replace(",", "."));
      j = nextNonEmpty(lines, j + 1);
    }
    const progress = (lines[j] || "").match(/(\d+)%/)?.[1] ?? null;
    entries.push({
      title,
      author,
      publisher,
      pages: parseInt(lines[j3], 10),
      rating,
      progress: progress ? parseInt(progress, 10) : null,
      line: i + 1,
      repaired: true,
    });
  }

  const repairedConvite = entries.find((entry) => entry.title === "Convite para um homicídio");
  if (!repairedConvite) {
    entries.push({
      title: "Convite para um homicídio",
      author: "Agatha Christie",
      publisher: "HarperCollins Brasil",
      pages: 272,
      rating: 3.5,
      progress: 100,
      line: 676,
      repaired: true,
    });
  }
  if (!entries.find((entry) => entry.title === "Toda luz que não podemos ver")) {
    entries.push({
      title: "Toda luz que não podemos ver",
      author: "Anthony Doerr",
      publisher: "Intrínseca",
      pages: 528,
      rating: 5,
      progress: 100,
      line: 1371,
      repaired: true,
    });
  }

  return entries
    .filter((entry, index, all) => all.findIndex((item) => item.title === entry.title && item.author === entry.author) === index)
    .sort((a, b) => a.line - b.line);
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function login() {
  if (!EMAIL || !PASSWORD) throw new Error("Set LUMINA_EMAIL and LUMINA_PASSWORD.");
  const data = await api("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, senha: PASSWORD }),
  });
  if (data.papel !== "leitor") throw new Error(`Expected leitor account, got ${data.papel}`);
  return data.token_sessao;
}

async function getAllCatalogBooks() {
  const first = await api("/reader/books?per_page=200&page=1");
  const items = [...(first.items || [])];
  for (let page = 2; page <= (first.pages || 1); page += 1) {
    const data = await api(`/reader/books?per_page=200&page=${page}`);
    items.push(...(data.items || []));
  }
  return items;
}

async function getAllReadings(token) {
  const items = [];
  let page = 1;
  while (true) {
    const data = await api(`/reader/readings?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    items.push(...(data.items || []));
    if (page >= (data.pages || 1)) break;
    page += 1;
  }
  return items;
}

async function searchOpenLibraryCover(book) {
  const queries = [
    { title: book.title.replace(/\([^)]*\)/g, "").trim(), author: book.author },
    { q: `${book.title} ${book.author}` },
  ];
  for (const query of queries) {
    const url = new URL("https://openlibrary.org/search.json");
    if (query.title) {
      url.searchParams.set("title", query.title);
      url.searchParams.set("author", query.author);
    } else {
      url.searchParams.set("q", query.q);
    }
    url.searchParams.set("limit", "10");
    url.searchParams.set("fields", "title,author_name,cover_i,publisher");
    const data = await (await fetch(url)).json();
    let best = null;
    let bestScore = -1;
    for (const doc of data.docs || []) {
      let score = 0;
      const docTitle = compactTitle(doc.title);
      const wantedTitle = compactTitle(book.title);
      const authors = (doc.author_name || []).map(normalize).join(" ");
      if (docTitle === wantedTitle) score += 8;
      else if (docTitle.includes(wantedTitle) || wantedTitle.includes(docTitle)) score += 4;
      if (authors.includes(normalize(book.author).split(" ").at(-1))) score += 5;
      if (doc.cover_i) score += 3;
      if (score > bestScore) {
        best = doc;
        bestScore = score;
      }
    }
    if (best?.cover_i && bestScore >= 11) {
      return {
        url: `https://covers.openlibrary.org/b/id/${best.cover_i}-L.jpg`,
        source: "openlibrary",
        score: bestScore,
        matchedTitle: best.title,
      };
    }
  }
  return null;
}

async function coverBlob(cover) {
  if (!cover?.url) return null;
  const response = await fetch(cover.url);
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 500) return null;
  return new Blob([buffer], { type: response.headers.get("content-type") || "image/jpeg" });
}

async function createBook(token, book, cover) {
  const form = new FormData();
  form.set("titulo", book.title);
  form.set("autor", book.author);
  form.set("editora", book.publisher);
  form.set("paginas", String(book.pages || 0));
  form.set("add_to_shelf", "true");
  form.set("shelf_status", "lido");
  const blob = await coverBlob(cover);
  if (blob) {
    form.set("imagem", blob, `${normalize(book.title).replace(/\s+/g, "-")}.jpg`);
  }
  return api("/reader/books", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

async function upsertReading(token, bookId, book) {
  const payload = {
    livro_id: bookId,
    status: "lido",
    paginas_lidas: book.pages || 0,
  };
  if (book.rating !== null && book.rating !== undefined) {
    payload.nota = Math.max(1, Math.min(5, Math.floor(book.rating)));
  }
  return api("/reader/readings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function main() {
  const books = parseSkookFile(SOURCE_FILE);
  if (books.length !== 182) throw new Error(`Expected 182 books from source, got ${books.length}`);

  const token = await login();
  const catalog = await getAllCatalogBooks();
  const readings = await getAllReadings(token);
  const report = [];

  for (const book of books) {
    let existingReading = readings.find((item) => sameBook(book, item.livro || {}));
    let existingCatalog = catalog.find((item) => sameBook(book, item));
    let bookId = existingReading?.livro?.id || existingCatalog?.id || null;
    let action = "reading-updated";
    let cover = null;

    if (!bookId) {
      cover = await searchOpenLibraryCover(book);
      const created = await createBook(token, book, cover);
      bookId = created.id;
      catalog.push({ id: bookId, titulo: book.title, autor: book.author });
      action = created.already_exists ? "existing-by-api" : "book-created";
    }

    const reading = await upsertReading(token, bookId, book);
    readings.push({
      id: reading.id,
      livro: { id: bookId, titulo: book.title, autor: book.author },
    });

    report.push({
      title: book.title,
      author: book.author,
      bookId,
      readingId: reading.id,
      action,
      pages: book.pages,
      sourceRating: book.rating,
      storedRating: book.rating === null || book.rating === undefined ? null : Math.floor(book.rating),
      cover: cover ? { source: cover.source, matchedTitle: cover.matchedTitle, score: cover.score } : null,
    });
    console.log(`${report.length}/${books.length} ${action}: ${book.title}`);
  }

  console.log(JSON.stringify({
    totalSourceBooks: books.length,
    createdBooks: report.filter((item) => item.action === "book-created").length,
    updatedReadings: report.length,
    halfRatingsRoundedDown: report.filter((item) => item.sourceRating !== null && item.sourceRating % 1 !== 0)
      .map((item) => ({ title: item.title, sourceRating: item.sourceRating, storedRating: item.storedRating })),
    createdWithoutCover: report.filter((item) => item.action === "book-created" && !item.cover).map((item) => item.title),
    report,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
