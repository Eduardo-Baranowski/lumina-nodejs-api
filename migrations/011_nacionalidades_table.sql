-- Create dedicated Nacionalidade table
CREATE TABLE nacionalidade (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(255) UNIQUE NOT NULL,
  flag VARCHAR(255),
  criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
