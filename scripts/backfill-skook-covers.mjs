const API_BASE = process.env.LUMINA_API_BASE || "https://lumina-nodejs-api.vercel.app";
const EMAIL = process.env.LUMINA_EMAIL;
const PASSWORD = process.env.LUMINA_PASSWORD;

const BOOKS = [
  { id: 197, title: "A Viuvinha", author: "José de Alencar", publisher: "FTD" },
  { id: 198, title: "Macário", author: "Álvares de Azevedo", publisher: "Itatiaia" },
  { id: 200, title: "O Juiz de Paz da Roça/Quem Casa Quer Casa/Os Dois ou O Inglês Maquinista", author: "Martins Pena", publisher: "W. Buch" },
  { id: 201, title: "Cordel: Patativa do Assaré (Biblioteca de Cordel)", author: "Patativa do Assaré", publisher: "Hedra" },
  { id: 202, title: "Histórias Pitorescas", author: "João Ubaldo Ribeiro", publisher: "Ediouro" },
  { id: 203, title: "O Vampiro Que Descobriu o Brasil", author: "Ivan Jaf", publisher: "Ática" },
  { id: 204, title: "Um Sonho no Caroço do Abacate", author: "Moacyr Scliar", publisher: "Global" },
  { id: 205, title: "Sete Ossos e Uma Maldição", author: "Rosa Amanda Strausz", publisher: "Rocco" },
  { id: 207, title: "Despedida de Solteiro", author: "Debbie Macomber", publisher: "Nova Cultural" },
  { id: 208, title: "A Sonâmbula (Casa do Pesadelo)", author: "Diane Hoh", publisher: "Rocco" },
  { id: 210, title: "Retratos Ingleses", author: "Charles Dickens", publisher: "Ediouro" },
  { id: 211, title: "O Caso dos Dez Negrinhos (Coleção Agatha Christie)", author: "Agatha Christie", publisher: "Record" },
  { id: 212, title: "A Captura de Cérbero (Os Diários Secretos de Agatha Christie: 50 Anos de Mistérios na Criação)", author: "Agatha Christie", publisher: "Leya" },
  { id: 213, title: "Contos Escolhidos", author: "Artur Azevedo", publisher: "O globo" },
  { id: 214, title: "Nicolau , o Filósofo", author: "Alexandre Dumas", publisher: "Ediouro" },
  { id: 215, title: "A Vitória da Infância", author: "Fernando Sabino", publisher: "Ática" },
  { id: 216, title: "O burguês e o crime e outros contos", author: "Carlos Heitor Cony", publisher: "Ediouro" },
  { id: 217, title: "Entre o Sertão e Sevilha", author: "João Cabral de Melo Neto", publisher: "Ediouro" },
  { id: 219, title: "Teatro de Machado de Assis", author: "Machado de Assis", publisher: "Martin Claret" },
  { id: 220, title: "A vaca e o hipogrifo (Coleção Folha Grandes Escritores Brasileiros #19)", author: "Mario Quintana", publisher: "Folha de São Paulo" },
  { id: 221, title: "Espelho mágico", author: "Mario Quintana", publisher: "Editora Globo" },
  { id: 222, title: "Antologia Poética (Coleção Prestígio)", author: "Mario Quintana", publisher: "Ediouro" },
  { id: 224, title: "O crime de Lord Arthur Savile", author: "Oscar Wilde", publisher: "Paulista" },
  { id: 225, title: "O Crime de Lord Arthur Savile e O Fantasma de Canterville", author: "Oscar Wilde", publisher: "Ediouro" },
];

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function importantTitleWords(title) {
  return normalize(title)
    .split(" ")
    .filter((w) => w.length > 2 && !["colecao", "biblioteca", "obra", "prima", "cada", "autor"].includes(w))
    .slice(0, 5);
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
  const data = await api("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, senha: PASSWORD }),
  });
  if (data.papel !== "leitor") throw new Error(`Expected leitor, got ${data.papel}`);
  return data.token_sessao;
}

async function duckDuckGoUrls(book) {
  const query = `site:skoob.com.br/pt/book "${book.title.replace(/\([^)]*\)/g, "").trim()}" "${book.author}"`;
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await (await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } })).text();
  return [...html.matchAll(/uddg=([^&]+)/g)]
    .map((m) => decodeURIComponent(m[1]))
    .filter((u) => /^https:\/\/www\.skoob\.com\.br\/pt\/book\/\d+/.test(u))
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .slice(0, 4);
}

function imageUrlsFromSkoobHtml(html) {
  return [...html.matchAll(/https?:\/\/[^"']+?(?:skoob|skeelo)[^"']+?\.(?:jpg|jpeg|png|webp)/gi)]
    .map((m) => m[0].replace(/\\u002F/g, "/"))
    .filter((u) => /livros\/|Book cover|_/.test(u))
    .filter((u, i, arr) => arr.indexOf(u) === i);
}

async function findSkoobCover(book) {
  const urls = await duckDuckGoUrls(book);
  for (const url of urls) {
    const html = await (await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } })).text();
    const normalizedHtml = normalize(html);
    const titleHits = importantTitleWords(book.title).filter((word) => normalizedHtml.includes(word)).length;
    const authorName = normalize(book.author);
    const authorLast = authorName.split(" ").at(-1);
    const authorOk = normalizedHtml.includes(authorName) || (authorLast && normalizedHtml.includes(authorLast));
    if (titleHits < Math.min(2, importantTitleWords(book.title).length) || !authorOk) continue;

    const imageUrl = imageUrlsFromSkoobHtml(html)[0];
    if (imageUrl) return { pageUrl: url, imageUrl };
  }
  return null;
}

async function blobFromUrl(url) {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 500) return null;
  return new Blob([buffer], { type: response.headers.get("content-type") || "image/jpeg" });
}

async function updateCover(token, book, cover) {
  const blob = await blobFromUrl(cover.imageUrl);
  if (!blob) return false;
  const form = new FormData();
  form.set("imagem", blob, `${normalize(book.title).replace(/\s+/g, "-")}.jpg`);
  await api(`/reader/books/${book.id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return true;
}

async function main() {
  if (!EMAIL || !PASSWORD) throw new Error("Set LUMINA_EMAIL and LUMINA_PASSWORD.");
  const token = await login();
  const report = [];
  for (const book of BOOKS) {
    const cover = await findSkoobCover(book);
    let updated = false;
    if (cover) {
      updated = await updateCover(token, book, cover);
    }
    report.push({ id: book.id, title: book.title, updated, cover });
    console.log(`${report.length}/${BOOKS.length} ${updated ? "cover-updated" : "no-safe-cover"}: ${book.title}`);
  }
  console.log(JSON.stringify({
    total: report.length,
    updated: report.filter((r) => r.updated).length,
    noSafeCover: report.filter((r) => !r.updated).map((r) => r.title),
    report,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
