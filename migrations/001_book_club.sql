-- Clube do Livro — tabelas de ciclo, indicações e votos
-- Execute no PostgreSQL antes de usar os endpoints /reader/book-club/*

CREATE TABLE IF NOT EXISTS book_club_cycle (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'votacao',
  data_inicio TIMESTAMP NOT NULL,
  data_fim_votacao TIMESTAMP NOT NULL,
  data_sorteio TIMESTAMP NULL,
  nomination_vencedora_id INTEGER NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS book_club_nomination (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES book_club_cycle(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  livro_id INTEGER NULL REFERENCES livro(id) ON DELETE SET NULL,
  titulo VARCHAR(200) NULL,
  autor VARCHAR(200) NULL,
  motivo TEXT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS book_club_vote (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES book_club_cycle(id) ON DELETE CASCADE,
  nomination_id INTEGER NOT NULL REFERENCES book_club_nomination(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, user_id, nomination_id)
);

CREATE INDEX IF NOT EXISTS idx_book_club_nomination_cycle ON book_club_nomination(cycle_id);
CREATE INDEX IF NOT EXISTS idx_book_club_vote_nomination ON book_club_vote(nomination_id);
CREATE INDEX IF NOT EXISTS idx_book_club_vote_cycle_user ON book_club_vote(cycle_id, user_id);

-- FK da indicação vencedora (após nomination existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_book_club_cycle_winner'
  ) THEN
    ALTER TABLE book_club_cycle
      ADD CONSTRAINT fk_book_club_cycle_winner
      FOREIGN KEY (nomination_vencedora_id)
      REFERENCES book_club_nomination(id) ON DELETE SET NULL;
  END IF;
END $$;
