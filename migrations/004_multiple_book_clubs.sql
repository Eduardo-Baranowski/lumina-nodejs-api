-- Migration para suporte a múltiplos clubes de livro (públicos e privados)

CREATE TABLE IF NOT EXISTS book_club (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  descricao TEXT NULL,
  imagem VARCHAR(255) NULL,
  privado BOOLEAN NOT NULL DEFAULT false,
  convite_codigo VARCHAR(20) UNIQUE NULL,
  criado_por_id INT NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_book_club_user FOREIGN KEY (criado_por_id) REFERENCES `user`(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS book_club_member (
  id INT AUTO_INCREMENT PRIMARY KEY,
  book_club_id INT NOT NULL,
  user_id INT NOT NULL,
  papel VARCHAR(20) NOT NULL DEFAULT 'membro', -- 'dono', 'membro'
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'pending_approval'
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_book_club_member (book_club_id, user_id),
  CONSTRAINT fk_book_club_member_club FOREIGN KEY (book_club_id) REFERENCES book_club(id) ON DELETE CASCADE,
  CONSTRAINT fk_book_club_member_user FOREIGN KEY (user_id) REFERENCES `user`(id) ON DELETE CASCADE
);

ALTER TABLE book_club_cycle ADD COLUMN IF NOT EXISTS book_club_id INT;
ALTER TABLE book_club_cycle ADD CONSTRAINT fk_book_club_cycle_book_club FOREIGN KEY (book_club_id) REFERENCES book_club(id) ON DELETE CASCADE;

INSERT INTO book_club (nome, descricao, privado, criado_por_id)
SELECT 'Clube Geral', 'O clube oficial do aplicativo, aberto a todos.', false,
  COALESCE(
    (SELECT id FROM `user` WHERE papel = 'admin' LIMIT 1),
    (SELECT id FROM `user` LIMIT 1)
  )
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM book_club WHERE nome = 'Clube Geral')
  AND EXISTS (SELECT 1 FROM `user`);

INSERT IGNORE INTO book_club_member (book_club_id, user_id, papel, status)
SELECT bc.id,
  COALESCE(
    (SELECT id FROM `user` WHERE papel = 'admin' LIMIT 1),
    (SELECT id FROM `user` LIMIT 1)
  ),
  'dono', 'active'
FROM book_club bc
WHERE bc.nome = 'Clube Geral';

UPDATE book_club_cycle
SET book_club_id = (SELECT id FROM book_club WHERE nome = 'Clube Geral' LIMIT 1)
WHERE book_club_id IS NULL;
