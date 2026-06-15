import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { BookClubNomination } from "./BookClubNomination";

import { BookClub } from "./BookClub";

@Entity("book_club_cycle")
export class BookClubCycle {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer", nullable: true })
  book_club_id: number | null;

  @Column({ type: "varchar", length: 80 })
  titulo: string;

  /** nominacao | votacao | sorteado | encerrado */
  @Column({ type: "varchar", length: 20, default: "votacao" })
  status: string;

  @Column({ type: "timestamp" })
  data_inicio: Date;

  @Column({ type: "timestamp" })
  data_fim_votacao: Date;

  @Column({ type: "timestamp", nullable: true })
  data_sorteio: Date | null;

  @Column({ type: "integer", nullable: true })
  nomination_vencedora_id: number | null;

  @CreateDateColumn({ type: "timestamp" })
  criado_em: Date;

  @ManyToOne(() => BookClubNomination, { nullable: true })
  @JoinColumn({ name: "nomination_vencedora_id" })
  nomination_vencedora: BookClubNomination | null;

  @ManyToOne(() => BookClub, { onDelete: "CASCADE" })
  @JoinColumn({ name: "book_club_id" })
  book_club: BookClub | null;
}
