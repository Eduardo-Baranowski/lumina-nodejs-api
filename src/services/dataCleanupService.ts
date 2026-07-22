import { EntityManager } from "typeorm";
import { User } from "../entities/User";
import { Friendship } from "../entities/Friendship";
import { Follow } from "../entities/Follow";
import { Message } from "../entities/Message";
import { BookClubVote } from "../entities/BookClubVote";
import { BookClubNomination } from "../entities/BookClubNomination";
import { BookClubMember } from "../entities/BookClubMember";
import { BookClubCycle } from "../entities/BookClubCycle";
import { BookClub } from "../entities/BookClub";
import { FeedLike } from "../entities/FeedLike";
import { FeedComment } from "../entities/FeedComment";
import { ItemPedido } from "../entities/ItemPedido";
import { Pedido } from "../entities/Pedido";
import { Compra } from "../entities/Compra";
import { Request } from "../entities/Request";
import { Leitura } from "../entities/Leitura";
import { Livro } from "../entities/Livro";
import { Endereco } from "../entities/Endereco";

const deleteByUserId = async (manager: EntityManager, entity: any, column: string, userId: number): Promise<void> => {
  await manager.getRepository(entity).createQueryBuilder().delete().where(`${column} = :userId`, { userId }).execute();
};

const deleteByBookId = async (manager: EntityManager, entity: any, column: string, bookId: number): Promise<void> => {
  await manager.getRepository(entity).createQueryBuilder().delete().where(`${column} = :bookId`, { bookId }).execute();
};

export const deleteUserAndRelated = async (userId: number, manager: EntityManager): Promise<void> => {
  await deleteByUserId(manager, Friendship, "requester_id", userId);
  await deleteByUserId(manager, Friendship, "addressee_id", userId);
  await deleteByUserId(manager, Follow, "follower_id", userId);
  await deleteByUserId(manager, Follow, "following_id", userId);
  await deleteByUserId(manager, Message, "sender_id", userId);
  await deleteByUserId(manager, Message, "receiver_id", userId);

  const nominationIds = await manager.getRepository(BookClubNomination)
    .createQueryBuilder("nomination")
    .select("nomination.id")
    .where("nomination.user_id = :userId", { userId })
    .getMany();

  if (nominationIds.length > 0) {
    await manager.getRepository(BookClubVote)
      .createQueryBuilder()
      .delete()
      .where("nomination_id IN (:...ids)", { ids: nominationIds.map((item) => item.id) })
      .execute();
  }

  await deleteByUserId(manager, BookClubVote, "user_id", userId);
  await deleteByUserId(manager, BookClubNomination, "user_id", userId);
  await deleteByUserId(manager, BookClubMember, "user_id", userId);

  const clubs = await manager.getRepository(BookClub)
    .createQueryBuilder("club")
    .select(["club.id"])
    .where("club.criado_por_id = :userId", { userId })
    .getMany();

  for (const club of clubs) {
    const cycleIds = await manager.getRepository(BookClubCycle)
      .createQueryBuilder("cycle")
      .select("cycle.id")
      .where("cycle.book_club_id = :clubId", { clubId: club.id })
      .getMany();

    if (cycleIds.length > 0) {
      await manager.getRepository(BookClubVote)
        .createQueryBuilder()
        .delete()
        .where("cycle_id IN (:...ids)", { ids: cycleIds.map((item) => item.id) })
        .execute();
      await manager.getRepository(BookClubNomination)
        .createQueryBuilder()
        .delete()
        .where("cycle_id IN (:...ids)", { ids: cycleIds.map((item) => item.id) })
        .execute();
    }

    await manager.getRepository(BookClubCycle)
      .createQueryBuilder()
      .update(BookClubCycle)
      .set({ nomination_vencedora_id: null })
      .where("book_club_id = :clubId", { clubId: club.id })
      .execute();

    await manager.getRepository(BookClubCycle)
      .createQueryBuilder()
      .delete()
      .where("book_club_id = :clubId", { clubId: club.id })
      .execute();
    await manager.getRepository(BookClubMember)
      .createQueryBuilder()
      .delete()
      .where("book_club_id = :clubId", { clubId: club.id })
      .execute();
    await manager.getRepository(BookClub)
      .createQueryBuilder()
      .delete()
      .where("id = :clubId", { clubId: club.id })
      .execute();
  }

  await deleteByUserId(manager, FeedLike, "user_id", userId);
  await deleteByUserId(manager, FeedComment, "user_id", userId);

  const pedidos = await manager.getRepository(Pedido)
    .createQueryBuilder("pedido")
    .select(["pedido.id"])
    .where("pedido.leitor_id = :userId", { userId })
    .getMany();

  if (pedidos.length > 0) {
    const pedidoIds = pedidos.map((pedido) => pedido.id);
    await manager.getRepository(ItemPedido)
      .createQueryBuilder()
      .delete()
      .where("pedido_id IN (:...ids)", { ids: pedidoIds })
      .execute();
  }

  await deleteByUserId(manager, Pedido, "leitor_id", userId);
  await deleteByUserId(manager, Compra, "leitor_id", userId);

  const books = await manager.getRepository(Livro)
    .createQueryBuilder("livro")
    .select(["livro.id"])
    .where("livro.editor_id = :userId", { userId })
    .getMany();

  for (const book of books) {
    await manager.getRepository(Request)
      .createQueryBuilder()
      .update(Request)
      .set({ livro_id: null })
      .where("livro_id = :bookId", { bookId: book.id })
      .execute();
    await manager.getRepository(BookClubNomination)
      .createQueryBuilder()
      .update(BookClubNomination)
      .set({ livro_id: null })
      .where("livro_id = :bookId", { bookId: book.id })
      .execute();

    const leituraIds = await manager.getRepository(Leitura)
      .createQueryBuilder("leitura")
      .select("leitura.id")
      .where("leitura.livro_id = :bookId", { bookId: book.id })
      .getMany();

    if (leituraIds.length > 0) {
      const ids = leituraIds.map((item) => item.id);
      await manager.getRepository(FeedLike)
        .createQueryBuilder()
        .delete()
        .where("leitura_id IN (:...ids)", { ids })
        .execute();
      await manager.getRepository(FeedComment)
        .createQueryBuilder()
        .delete()
        .where("leitura_id IN (:...ids)", { ids })
        .execute();
    }

    await manager.getRepository(Leitura)
      .createQueryBuilder()
      .delete()
      .where("livro_id = :bookId", { bookId: book.id })
      .execute();
    await manager.getRepository(Livro)
      .createQueryBuilder()
      .delete()
      .where("id = :bookId", { bookId: book.id })
      .execute();
  }

  const leiturasDoUser = await manager.getRepository(Leitura)
    .createQueryBuilder("leitura")
    .select(["leitura.id"])
    .where("leitura.leitor_id = :userId", { userId })
    .getMany();

  if (leiturasDoUser.length > 0) {
    const leituraIds = leiturasDoUser.map((item) => item.id);
    await manager.getRepository(FeedLike)
      .createQueryBuilder()
      .delete()
      .where("leitura_id IN (:...ids)", { ids: leituraIds })
      .execute();
    await manager.getRepository(FeedComment)
      .createQueryBuilder()
      .delete()
      .where("leitura_id IN (:...ids)", { ids: leituraIds })
      .execute();
  }

  await manager.getRepository(Leitura)
    .createQueryBuilder()
    .delete()
    .where("leitor_id = :userId", { userId })
    .execute();
  await manager.getRepository(Request)
    .createQueryBuilder()
    .delete()
    .where("leitor_id = :userId OR editor_id = :userId", { userId })
    .execute();
  await manager.getRepository(Endereco)
    .createQueryBuilder()
    .delete()
    .where("user_id = :userId", { userId })
    .execute();

  const user = await manager.getRepository(User).findOneBy({ id: userId });
  if (user) {
    await manager.getRepository(User).remove(user);
  }
};

export const deleteBookAndRelated = async (bookId: number, manager: EntityManager): Promise<void> => {
  await manager.getRepository(Request)
    .createQueryBuilder()
    .update(Request)
    .set({ livro_id: null })
    .where("livro_id = :bookId", { bookId })
    .execute();
  await manager.getRepository(BookClubNomination)
    .createQueryBuilder()
    .update(BookClubNomination)
    .set({ livro_id: null })
    .where("livro_id = :bookId", { bookId })
    .execute();

  await manager.getRepository(ItemPedido)
    .createQueryBuilder()
    .delete()
    .where("livro_id = :bookId", { bookId })
    .execute();
  await manager.getRepository(Compra)
    .createQueryBuilder()
    .delete()
    .where("livro_id = :bookId", { bookId })
    .execute();

  const leituraIds = await manager.getRepository(Leitura)
    .createQueryBuilder("leitura")
    .select("leitura.id")
    .where("leitura.livro_id = :bookId", { bookId })
    .getMany();

  if (leituraIds.length > 0) {
    const ids = leituraIds.map((item) => item.id);
    await manager.getRepository(FeedLike)
      .createQueryBuilder()
      .delete()
      .where("leitura_id IN (:...ids)", { ids })
      .execute();
    await manager.getRepository(FeedComment)
      .createQueryBuilder()
      .delete()
      .where("leitura_id IN (:...ids)", { ids })
      .execute();
  }

  await manager.getRepository(Leitura)
    .createQueryBuilder()
    .delete()
    .where("livro_id = :bookId", { bookId })
    .execute();

  const book = await manager.getRepository(Livro).findOneBy({ id: bookId });
  if (book) {
    await manager.getRepository(Livro).remove(book);
  }
};
