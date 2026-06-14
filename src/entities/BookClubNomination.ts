import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./User";
import { Livro } from "./Livro";
import { BookClubCycle } from "./BookClubCycle";

@Entity("book_club_nomination")
export class BookClubNomination {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  cycle_id: number;

  @Column({ type: "integer" })
  user_id: number;

  @Column({ type: "integer", nullable: true })
  livro_id: number | null;

  @Column({ type: "varchar", length: 200, nullable: true })
  titulo: string | null;

  @Column({ type: "varchar", length: 200, nullable: true })
  autor: string | null;

  @Column({ type: "text", nullable: true })
  motivo: string | null;

  @CreateDateColumn({ type: "timestamp" })
  criado_em: Date;

  @ManyToOne(() => BookClubCycle)
  @JoinColumn({ name: "cycle_id" })
  cycle: BookClubCycle;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user: User;

  @ManyToOne(() => Livro, { nullable: true })
  @JoinColumn({ name: "livro_id" })
  livro: Livro | null;
}
