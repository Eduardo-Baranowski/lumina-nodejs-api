CREATE TABLE IF NOT EXISTS "endereco" (
  "id" SERIAL PRIMARY KEY,
  "user_id" integer NOT NULL,
  "label" varchar(255) NOT NULL,
  "rua" varchar(255) NOT NULL,
  "numero" varchar(50) NOT NULL,
  "bairro" varchar(255) NOT NULL,
  "cidade" varchar(255) NOT NULL,
  "estado" varchar(100) NOT NULL,
  "cep" varchar(20) NOT NULL,
  "criado_em" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "fk_endereco_user_id" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
);
