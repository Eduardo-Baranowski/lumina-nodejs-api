-- Migration: adiciona coluna nacionalidade em autor

ALTER TABLE "autor"
ADD COLUMN IF NOT EXISTS "nacionalidade" varchar(100);
