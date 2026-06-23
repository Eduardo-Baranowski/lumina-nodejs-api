-- Autores rastreáveis + cadastro comunitário de livros

CREATE TABLE IF NOT EXISTS autor (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(200) NOT NULL,
  slug VARCHAR(220) NOT NULL UNIQUE,
  bio TEXT,
  imagem VARCHAR(255),
  open_library_key VARCHAR(50),
  criado_em TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS autor_nome_lower_idx ON autor (LOWER(nome));

CREATE TABLE IF NOT EXISTS livro_autor (
  livro_id INTEGER NOT NULL REFERENCES livro(id) ON DELETE CASCADE,
  autor_id INTEGER NOT NULL REFERENCES autor(id) ON DELETE CASCADE,
  ordem SMALLINT DEFAULT 0,
  PRIMARY KEY (livro_id, autor_id)
);

CREATE INDEX IF NOT EXISTS livro_autor_autor_id_idx ON livro_autor (autor_id);

ALTER TABLE livro ADD COLUMN IF NOT EXISTS isbn VARCHAR(20);
ALTER TABLE livro ADD COLUMN IF NOT EXISTS submitted_by_id INTEGER REFERENCES "user"(id);
ALTER TABLE livro ADD COLUMN IF NOT EXISTS open_library_key VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS livro_isbn_unique ON livro (isbn)
  WHERE isbn IS NOT NULL AND isbn != '';

-- Backfill: um autor por string completa em livro.autor (legado)
INSERT INTO autor (nome, slug)
SELECT DISTINCT
  l.autor,
  lower(regexp_replace(l.autor, '[^a-zA-Z0-9]+', '-', 'g'))
    || '-'
    || substr(md5(lower(l.autor)), 1, 6)
FROM livro l
WHERE l.autor IS NOT NULL
  AND trim(l.autor) != ''
  AND NOT EXISTS (
    SELECT 1 FROM autor a WHERE lower(a.nome) = lower(l.autor)
  );

INSERT INTO livro_autor (livro_id, autor_id, ordem)
SELECT l.id, a.id, 0
FROM livro l
JOIN autor a ON lower(a.nome) = lower(l.autor)
ON CONFLICT DO NOTHING;
