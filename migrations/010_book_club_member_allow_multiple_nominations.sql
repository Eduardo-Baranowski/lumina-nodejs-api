-- Adiciona permissão para múltiplas indicações de membro no clube do livro
ALTER TABLE book_club_member
  ADD COLUMN IF NOT EXISTS allow_multiple_nominations BOOLEAN NOT NULL DEFAULT FALSE;
