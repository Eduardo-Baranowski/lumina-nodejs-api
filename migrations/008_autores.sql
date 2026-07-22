-- Autores rastreáveis + cadastro comunitário de livros

CREATE TABLE IF NOT EXISTS autor (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(200) NOT NULL,
  slug VARCHAR(220) NOT NULL UNIQUE,
  bio TEXT,
  imagem VARCHAR(255),
  open_library_key VARCHAR(50),
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS autor_nome_lower_idx ON autor (nome);

CREATE TABLE IF NOT EXISTS livro_autor (
  livro_id INT NOT NULL,
  autor_id INT NOT NULL,
  ordem SMALLINT DEFAULT 0,
  PRIMARY KEY (livro_id, autor_id),
  CONSTRAINT fk_livro_autor_livro FOREIGN KEY (livro_id) REFERENCES livro(id) ON DELETE CASCADE,
  CONSTRAINT fk_livro_autor_autor FOREIGN KEY (autor_id) REFERENCES autor(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS livro_autor_autor_id_idx ON livro_autor (autor_id);

ALTER TABLE livro ADD COLUMN IF NOT EXISTS isbn VARCHAR(20);
ALTER TABLE livro ADD COLUMN IF NOT EXISTS submitted_by_id INT;
ALTER TABLE livro ADD COLUMN IF NOT EXISTS open_library_key VARCHAR(50);
ALTER TABLE livro ADD CONSTRAINT fk_livro_submitted_by FOREIGN KEY (submitted_by_id) REFERENCES `user`(id);

CREATE UNIQUE INDEX IF NOT EXISTS livro_isbn_unique ON livro (isbn);

-- Backfill: um autor por string completa em livro.autor (legado)
INSERT INTO autor (nome, slug)
SELECT DISTINCT
  l.autor,
  CONCAT(
    LOWER(REGEXP_REPLACE(l.autor, '[^a-zA-Z0-9]+', '-')),
    '-',
    SUBSTR(MD5(LOWER(l.autor)), 1, 6)
  )
FROM livro l
WHERE l.autor IS NOT NULL
  AND TRIM(l.autor) != ''
  AND NOT EXISTS (
    SELECT 1 FROM autor a WHERE LOWER(a.nome) = LOWER(l.autor)
  );

INSERT IGNORE INTO livro_autor (livro_id, autor_id, ordem)
SELECT l.id, a.id, 0
FROM livro l
JOIN autor a ON LOWER(a.nome) = LOWER(l.autor);
