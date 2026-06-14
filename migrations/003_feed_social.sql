-- Feed social: curtidas e comentários em atividades de leitura

CREATE TABLE IF NOT EXISTS feed_like (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  leitura_id INTEGER NOT NULL REFERENCES leitura(id) ON DELETE CASCADE,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, leitura_id)
);

CREATE INDEX IF NOT EXISTS idx_feed_like_leitura ON feed_like(leitura_id);
CREATE INDEX IF NOT EXISTS idx_feed_like_user ON feed_like(user_id);

CREATE TABLE IF NOT EXISTS feed_comment (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  leitura_id INTEGER NOT NULL REFERENCES leitura(id) ON DELETE CASCADE,
  conteudo TEXT NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feed_comment_leitura ON feed_comment(leitura_id);
