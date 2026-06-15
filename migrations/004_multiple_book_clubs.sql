-- Migration para suporte a múltiplos clubes de livro (públicos e privados)

CREATE TABLE IF NOT EXISTS book_club (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  descricao TEXT NULL,
  imagem VARCHAR(255) NULL,
  privado BOOLEAN NOT NULL DEFAULT false,
  convite_codigo VARCHAR(20) UNIQUE NULL,
  criado_por_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS book_club_member (
  id SERIAL PRIMARY KEY,
  book_club_id INTEGER NOT NULL REFERENCES book_club(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  papel VARCHAR(20) NOT NULL DEFAULT 'membro', -- 'dono', 'membro'
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'pending_approval'
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (book_club_id, user_id)
);

ALTER TABLE book_club_cycle ADD COLUMN IF NOT EXISTS book_club_id INTEGER REFERENCES book_club(id) ON DELETE CASCADE;

-- Migração dos ciclos existentes para um novo "Clube Geral"
DO $$
DECLARE
  v_admin_id INTEGER;
  v_club_id INTEGER;
BEGIN
  -- Encontra um admin
  SELECT id INTO v_admin_id FROM "user" WHERE papel = 'admin' LIMIT 1;
  
  -- Se não achar, pega o primeiro usuário
  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM "user" LIMIT 1;
  END IF;

  -- Se houver usuários, cria o Clube Geral
  IF v_admin_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM book_club WHERE nome = 'Clube Geral') THEN
      INSERT INTO book_club (nome, descricao, privado, criado_por_id)
      VALUES ('Clube Geral', 'O clube oficial do aplicativo, aberto a todos.', false, v_admin_id)
      RETURNING id INTO v_club_id;
      
      INSERT INTO book_club_member (book_club_id, user_id, papel, status)
      VALUES (v_club_id, v_admin_id, 'dono', 'active');
      
      UPDATE book_club_cycle SET book_club_id = v_club_id WHERE book_club_id IS NULL;
    END IF;
  END IF;
END $$;
