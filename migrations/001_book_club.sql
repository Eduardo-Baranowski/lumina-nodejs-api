-- Clube do Livro — tabelas de ciclo, indicações e votos
-- Executa em MySQL para habilitar endpoints /reader/book-club/*

CREATE TABLE IF NOT EXISTS book_club_cycle (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'votacao',
  data_inicio TIMESTAMP NOT NULL,
  data_fim_votacao TIMESTAMP NOT NULL,
  data_sorteio TIMESTAMP NULL,
  nomination_vencedora_id INT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS book_club_nomination (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cycle_id INT NOT NULL,
  user_id INT NOT NULL,
  livro_id INT NULL,
  titulo VARCHAR(200) NULL,
  autor VARCHAR(200) NULL,
  motivo TEXT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_book_club_nomination_cycle FOREIGN KEY (cycle_id) REFERENCES book_club_cycle(id) ON DELETE CASCADE,
  CONSTRAINT fk_book_club_nomination_user FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE,
  CONSTRAINT fk_book_club_nomination_livro FOREIGN KEY (livro_id) REFERENCES livro(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS book_club_vote (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cycle_id INT NOT NULL,
  nomination_id INT NOT NULL,
  user_id INT NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_book_club_vote_cycle_user (cycle_id, user_id, nomination_id),
  CONSTRAINT fk_book_club_vote_cycle FOREIGN KEY (cycle_id) REFERENCES book_club_cycle(id) ON DELETE CASCADE,
  CONSTRAINT fk_book_club_vote_nomination FOREIGN KEY (nomination_id) REFERENCES book_club_nomination(id) ON DELETE CASCADE,
  CONSTRAINT fk_book_club_vote_user FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_book_club_nomination_cycle ON book_club_nomination(cycle_id);
CREATE INDEX IF NOT EXISTS idx_book_club_vote_nomination ON book_club_vote(nomination_id);
CREATE INDEX IF NOT EXISTS idx_book_club_vote_cycle_user ON book_club_vote(cycle_id, user_id);

ALTER TABLE book_club_cycle
  ADD CONSTRAINT fk_book_club_cycle_winner
  FOREIGN KEY (nomination_vencedora_id)
  REFERENCES book_club_nomination(id) ON DELETE SET NULL;
