-- Add nacionalidade column to autor
ALTER TABLE autor ADD COLUMN IF NOT EXISTS nacionalidade varchar(100);
