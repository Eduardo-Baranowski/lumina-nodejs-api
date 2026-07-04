const API_BASE = process.env.LUMINA_API_BASE || "https://lumina-nodejs-api.vercel.app";
const EMAIL = process.env.LUMINA_EMAIL;
const PASSWORD = process.env.LUMINA_PASSWORD;

const BOOKS = [
  { title: "Cinco Minutos", author: "José de Alencar", publisher: "Moderna", pages: 53 },
  { title: "A Viuvinha", author: "José de Alencar", publisher: "FTD", pages: 79 },
  { title: "Macário", author: "Álvares de Azevedo", publisher: "Itatiaia", pages: 127, rating: 3 },
  { title: "Ubirajara", author: "José de Alencar", publisher: "Martin Claret", pages: 136 },
  { title: "O Juiz de Paz da Roça/Quem Casa Quer Casa/Os Dois ou O Inglês Maquinista", author: "Martins Pena", publisher: "W. Buch", pages: 159 },
  { title: "Cordel: Patativa do Assaré (Biblioteca de Cordel)", author: "Patativa do Assaré", publisher: "Hedra", pages: 136 },
  { title: "Histórias Pitorescas", author: "João Ubaldo Ribeiro", publisher: "Ediouro", pages: 95 },
  { title: "O Vampiro Que Descobriu o Brasil", author: "Ivan Jaf", publisher: "Ática", pages: 125, rating: 5 },
  { title: "Um Sonho no Caroço do Abacate", author: "Moacyr Scliar", publisher: "Global", pages: 80 },
  { title: "Sete Ossos e Uma Maldição", author: "Rosa Amanda Strausz", publisher: "Rocco", pages: 118, rating: 4 },
  { title: "Friday", author: "Robert A. Heinlein", publisher: "Francisco Alves", pages: 388, rating: 1 },
  { title: "Despedida de Solteiro", author: "Debbie Macomber", publisher: "Nova Cultural", pages: 127 },
  { title: "A Sonâmbula (Casa do Pesadelo)", author: "Diane Hoh", publisher: "Rocco", pages: 137, rating: 4 },
  { title: "Fábulas (A Obra-Prima de Cada Autor)", author: "Jean de La Fontaine", publisher: "Martin Claret", pages: 304 },
  { title: "Retratos Ingleses", author: "Charles Dickens", publisher: "Ediouro", pages: 112 },
  { title: "O Caso dos Dez Negrinhos (Coleção Agatha Christie)", author: "Agatha Christie", publisher: "Record (Coleção Agatha Christie)", pages: 218, rating: 5 },
  { title: "A Captura de Cérbero (Os Diários Secretos de Agatha Christie: 50 Anos de Mistérios na Criação)", author: "Agatha Christie", publisher: "Leya", pages: 96, rating: 3 },
  { title: "Contos Escolhidos", author: "Artur Azevedo", publisher: "O globo", pages: 158 },
  { title: "Nicolau , o Filósofo", author: "Alexandre Dumas", publisher: "Ediouro", pages: 96 },
  { title: "A Vitória da Infância", author: "Fernando Sabino", publisher: "Ática", pages: 166 },
  { title: "O burguês e o crime e outros contos", author: "Carlos Heitor Cony", publisher: "Ediouro", pages: 108 },
  { title: "Entre o Sertão e Sevilha", author: "João Cabral de Melo Neto", publisher: "Ediouro", pages: 110 },
  { title: "Amor de Perdição (A Obra-Prima de Cada Autor #15)", author: "Camilo Castelo Branco", publisher: "Martin Claret", pages: 176 },
  { title: "Teatro de Machado de Assis", author: "Machado de Assis", publisher: "Martin Claret", pages: 264 },
  { title: "A vaca e o hipogrifo (Coleção Folha Grandes Escritores Brasileiros #19)", author: "Mario Quintana", publisher: "Folha de São Paulo", pages: 272, rating: 5 },
  { title: "Espelho mágico", author: "Mario Quintana", publisher: "Editora Globo", pages: 80, rating: 5 },
  { title: "Antologia Poética (Coleção Prestígio)", author: "Mario Quintana", publisher: "Ediouro / Tecnoprint S. A.", pages: 113 },
  { title: "Urupês", author: "Monteiro Lobato", publisher: "Brasiliense", pages: 184 },
  { title: "O crime de Lord Arthur Savile", author: "Oscar Wilde", publisher: "Paulista", pages: 179 },
  { title: "O Crime de Lord Arthur Savile e O Fantasma de Canterville", author: "Oscar Wilde", publisher: "Ediouro", pages: 112 },
];

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " e ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function compactTitle(value) {
  return normalize(value)
    .replace(/\bcolecao\b/g, "")
    .replace(/\bbiblioteca\b/g, "")
    .replace(/\bobra prima de cada autor\b/g, "")
    .replace(/\bprestigio\b/g, "")
    .replace(/\bfolha grandes escritores brasileiros\b/g, "")
    .replace(/\bos diarios secretos de agatha christie\b/g, "")
    .replace(/\b50 anos de misterios na criacao\b/g, "")
    .replace(/\b\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sameBook(a, b) {
  return compactTitle(a.title || a.titulo) === compactTitle(b.title || b.titulo)
    && normalize(a.author || a.autor) === normalize(b.author || b.autor);
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
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function login() {
  if (!EMAIL || !PASSWORD) {
    throw new Error("Set LUMINA_EMAIL and LUMINA_PASSWORD.");
  }
  const data = await api("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, senha: PASSWORD }),
  });
  if (data.papel !== "leitor") {
    throw new Error(`Expected leitor account, got ${data.papel}`);
  }
  return data.token_sessao;
}

async function getAllBooks() {
  const first = await api("/reader/books?per_page=200&page=1");
  return first.items || [];
}

async function getAllReadings(token) {
  const readings = [];
  let page = 1;
  while (true) {
    const data = await api(`/reader/readings?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    readings.push(...(data.items || []));
    if (page >= (data.pages || 1)) break;
    page += 1;
  }
  return readings;
}

async function searchOpenLibrary(book) {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("title", book.title.replace(/\([^)]*\)/g, "").trim());
  url.searchParams.set("author", book.author);
  url.searchParams.set("limit", "10");
  url.searchParams.set("fields", "title,author_name,cover_i,publisher,number_of_pages_median");
  const data = await (await fetch(url)).json();
  const docs = data.docs || [];
  let best = null;
  let bestScore = -1;

  for (const doc of docs) {
    let score = 0;
    const docTitle = compactTitle(doc.title);
    const wantedTitle = compactTitle(book.title);
    const docAuthors = (doc.author_name || []).map(normalize).join(" ");
    if (docTitle === wantedTitle) score += 8;
    else if (docTitle.includes(wantedTitle) || wantedTitle.includes(docTitle)) score += 4;
    if (docAuthors.includes(normalize(book.author))) score += 5;
    if (doc.cover_i) score += 3;
    if ((doc.publisher || []).some((p) => normalize(p).includes(normalize(book.publisher).split(" ")[0]))) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = doc;
    }
  }

  if (!best || !best.cover_i || bestScore < 8) return null;
  return {
    coverId: best.cover_i,
    coverUrl: `https://covers.openlibrary.org/b/id/${best.cover_i}-L.jpg`,
    matchedTitle: best.title,
    matchedAuthors: best.author_name || [],
    score: bestScore,
  };
}

async function fetchCoverBlob(match) {
  if (!match?.coverUrl) return null;
  const response = await fetch(match.coverUrl);
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 500) return null;
  return new Blob([buffer], { type: response.headers.get("content-type") || "image/jpeg" });
}

async function createCommunityBook(token, book, coverMatch) {
  const form = new FormData();
  form.set("titulo", book.title);
  form.set("autor", book.author);
  form.set("editora", book.publisher);
  form.set("paginas", String(book.pages));
  form.set("add_to_shelf", "true");
  form.set("shelf_status", "lido");

  const blob = await fetchCoverBlob(coverMatch);
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
  return api("/reader/readings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      livro_id: bookId,
      status: "lido",
      nota: book.rating ?? null,
      paginas_lidas: book.pages,
    }),
  });
}

async function main() {
  const token = await login();
  const catalog = await getAllBooks();
  const readings = await getAllReadings(token);
  const report = [];

  for (const book of BOOKS) {
    const existingCatalog = catalog.find((item) => sameBook(book, item));
    const existingReading = readings.find((item) => sameBook(book, item.livro || {}));
    let bookId = existingCatalog?.id || existingReading?.livro?.id || null;
    let action = "reading-updated";
    let coverMatch = null;

    if (!bookId) {
      coverMatch = await searchOpenLibrary(book);
      const created = await createCommunityBook(token, book, coverMatch);
      bookId = created.id;
      catalog.push({ id: bookId, titulo: book.title, autor: book.author });
      action = created.already_exists ? "existing-by-api" : "book-created";
    }

    const reading = await upsertReading(token, bookId, book);
    report.push({
      title: book.title,
      author: book.author,
      bookId,
      readingId: reading.id,
      action,
      rating: book.rating ?? null,
      pagesRead: book.pages,
      cover: coverMatch ? {
        id: coverMatch.coverId,
        matchedTitle: coverMatch.matchedTitle,
        matchedAuthors: coverMatch.matchedAuthors,
        score: coverMatch.score,
      } : null,
    });
    console.log(`${report.length}/${BOOKS.length} ${action}: ${book.title}`);
  }

  console.log(JSON.stringify({
    total: BOOKS.length,
    createdBooks: report.filter((r) => r.action === "book-created").length,
    updatedReadings: report.length,
    withoutCoverMatch: report.filter((r) => r.action === "book-created" && !r.cover).map((r) => r.title),
    report,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
