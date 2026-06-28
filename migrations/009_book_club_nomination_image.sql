-- Adiciona campo de imagem para indicações do clube do livro
ALTER TABLE book_club_nomination
  ADD COLUMN IF NOT EXISTS imagem VARCHAR(1000) NULL;
