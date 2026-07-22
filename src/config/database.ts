import "reflect-metadata";
import { DataSource } from "typeorm";
import { User } from "../entities/User";
import { Livro } from "../entities/Livro";
import { Request } from "../entities/Request";
import { Leitura } from "../entities/Leitura";
import { Compra } from "../entities/Compra";
import { Follow } from "../entities/Follow";
import { Friendship } from "../entities/Friendship";
import { Message } from "../entities/Message";
import { Pedido } from "../entities/Pedido";
import { ItemPedido } from "../entities/ItemPedido";
import { FeedLike } from "../entities/FeedLike";
import { FeedComment } from "../entities/FeedComment";
import { BookClubCycle } from "../entities/BookClubCycle";
import { BookClubNomination } from "../entities/BookClubNomination";
import { BookClubVote } from "../entities/BookClubVote";
import { Endereco } from "../entities/Endereco";
import { BookClub } from "../entities/BookClub";
import { BookClubMember } from "../entities/BookClubMember";
import { Editora } from "../entities/Editora";
import { Autor } from "../entities/Autor";
import { LivroAutor } from "../entities/LivroAutor";
import { Nacionalidade } from "../entities/Nacionalidade";
import { Frase } from "../entities/Frase";
import * as dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const databaseUrl = process.env.DATABASE_URL || "";
const isPostgres = /^postgres(ql)?:\/\//i.test(databaseUrl);
const databaseType = isPostgres ? "postgres" : "mysql";
const postgresSsl =
  isPostgres &&
  (isProduction || /supabase\.co/i.test(databaseUrl) || /(?:sslmode=require|sslmode=verify-full|ssl=true)/i.test(databaseUrl));

export const AppDataSource = new DataSource({
  type: databaseType as "mysql" | "postgres",
  url: databaseUrl,
  synchronize: false, // DO NOT sync schema to avoid corrupting/overwriting the database
  logging: false,
  ...(databaseType === "mysql"
    ? {
        charset: "utf8mb4",
      }
    : {}),
  extra: {
    connectionLimit: isProduction ? 2 : 10,
    connectTimeout: 10000,
    ...(postgresSsl
      ? {
          ssl: { rejectUnauthorized: false },
        }
      : {}),
  },
  entities: [
    User,
    Livro,
    Request,
    Leitura,
    Compra,
    Follow,
    Friendship,
    Message,
    Pedido,
    ItemPedido,
    FeedLike,
    FeedComment,
    BookClubCycle,
    BookClubNomination,
    BookClubVote,
    Endereco,
    BookClub,
    BookClubMember,
    Editora,
    Autor,
    LivroAutor,
    Nacionalidade,
    Frase,
  ],
  subscribers: [],
  migrations: [],
});

