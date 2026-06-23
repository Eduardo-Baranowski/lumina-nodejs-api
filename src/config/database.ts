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
import * as dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

export const AppDataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  synchronize: false, // DO NOT sync schema to avoid corrupting/overwriting the database
  logging: false,
  // SSL obrigatório para Supabase; desabilitado em dev local
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  // Em serverless (Vercel), manter pool mínimo para evitar esgotar conexões
  extra: isProduction
    ? { max: 2, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 }
    : {},
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
  ],
  subscribers: [],
  migrations: [],
});

