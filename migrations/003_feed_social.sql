-- Feed social: curtidas e comentários em atividades de leitura

CREATE TABLE IF NOT EXISTS feed_like (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  leitura_id INT NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_feed_like_user_leitura (user_id, leitura_id),
  CONSTRAINT fk_feed_like_user FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE,
  CONSTRAINT fk_feed_like_leitura FOREIGN KEY (leitura_id) REFERENCES leitura(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feed_like_leitura ON feed_like(leitura_id);
CREATE INDEX IF NOT EXISTS idx_feed_like_user ON feed_like(user_id);

CREATE TABLE IF NOT EXISTS feed_comment (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  leitura_id INT NOT NULL,
  conteudo TEXT NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_feed_comment_user FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE,
  CONSTRAINT fk_feed_comment_leitura FOREIGN KEY (leitura_id) REFERENCES leitura(id) ON DELETE CASCADE
);

CREATE INDEX idx_feed_comment_leitura ON feed_comment(leitura_id);
