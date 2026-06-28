import "reflect-metadata";
import * as dotenv from "dotenv";
dotenv.config();

import { AppDataSource } from "../config/database";
import { Autor } from "../entities/Autor";
import { Nacionalidade } from "../entities/Nacionalidade";

async function main() {
  await AppDataSource.initialize();
  const nationalityRepo = AppDataSource.getRepository(Nacionalidade);
  const autorRepo = AppDataSource.getRepository(Autor);

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
    for (const nome of nacionalidades) {
      const exists = await nationalityRepo.findOne({ where: { nome } });
      if (exists) continue;

      const nationality = nationalityRepo.create({ nome, flag: null });
      await nationalityRepo.save(nationality);
      created++;
      console.log(`Created seed nationality: ${nome}`);
    }

    const authorRows = await autorRepo
      .createQueryBuilder('autor')
      .select('DISTINCT autor.nacionalidade', 'nacionalidade')
      .where("autor.nacionalidade IS NOT NULL AND autor.nacionalidade <> ''")
      .getRawMany();

    for (const row of authorRows) {
      const nome = String(row.nacionalidade).trim();
      if (!nome) continue;
      const exists = await nationalityRepo.findOne({ where: { nome } });
      if (exists) continue;
      const nationality = nationalityRepo.create({ nome, flag: null });
      await nationalityRepo.save(nationality);
      created++;
      console.log(`Backfilled nationality from authors: ${nome}`);
    }

    console.log(`Seed finished. Nationalities created: ${created}`);
  } catch (err) {
    console.error('Error running seed:', err);
    process.exit(1);
  } finally {
    await AppDataSource.destroy();
  }

  console.log(`Seed finished. New authors created: ${created}`);
}

main();
