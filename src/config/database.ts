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
import * as dotenv from "dotenv";

dotenv.config();

export const AppDataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  synchronize: false, // DO NOT sync schema to avoid corrupting/overwriting the database
  logging: false,
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
  ],
  subscribers: [],
  migrations: [],
});
