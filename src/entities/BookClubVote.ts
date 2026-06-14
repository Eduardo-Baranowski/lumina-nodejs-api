import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./User";
import { BookClubCycle } from "./BookClubCycle";
import { BookClubNomination } from "./BookClubNomination";

@Entity("book_club_vote")
export class BookClubVote {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  cycle_id: number;

  @Column({ type: "integer" })
  nomination_id: number;

  @Column({ type: "integer" })
  user_id: number;

  @CreateDateColumn({ type: "timestamp" })
  criado_em: Date;

  @ManyToOne(() => BookClubCycle)
  @JoinColumn({ name: "cycle_id" })
  cycle: BookClubCycle;

  @ManyToOne(() => BookClubNomination)
  @JoinColumn({ name: "nomination_id" })
  nomination: BookClubNomination;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user: User;
}
