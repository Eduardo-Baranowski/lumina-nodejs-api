import "reflect-metadata";
import * as dotenv from "dotenv";
dotenv.config();

import { AppDataSource } from "../config/database";
import { Autor } from "../entities/Autor";
import { slugifyAuthorName } from "../services/authorService";

async function main() {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(Autor);

  const nacionalidades = [
    'Brasileira',
    'Inglesa',
    'Americana',
    'Portuguesa',
    'Francesa',
    'Alemã',
    'Italiana',
    'Espanhola',
    'Canadense',
    'Japonesa',
    'Chinesa',
    'Indiana',
    'Australiana',
    'Russa',
    'Sueca',
    'Holandesa',
    'Mexicana',
    'Argentina',
    'Chilena',
    'Colombiana'
  ];

  let created = 0;
  try {
    for (const n of nacionalidades) {
      const exists = await repo
        .createQueryBuilder('a')
        .where('a.nacionalidade = :n', { n })
        .getOne();
      if (exists) continue;

      const name = `Seed Nacionalidade ${n}`;
      const slug = slugifyAuthorName(name);
      const novo = repo.create({
        nome: name,
        slug,
        bio: null,
        imagem: null,
        nacionalidade: n,
        open_library_key: null,
      } as Partial<Autor>);
      await repo.save(novo);
      created++;
      console.log(`Created seed author for nacionalidade: ${n}`);
    }
  } catch (err) {
    console.error('Error running seed:', err);
    process.exit(1);
  } finally {
    await AppDataSource.destroy();
  }

  console.log(`Seed finished. New authors created: ${created}`);
}

main();
