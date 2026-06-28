import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from "typeorm";
import { User } from "./User";
import { BookClub } from "./BookClub";

@Entity("book_club_member")
@Unique(["book_club_id", "user_id"])
export class BookClubMember {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  book_club_id: number;

  @Column({ type: "integer" })
  user_id: number;

  @Column({ type: "varchar", length: 20, default: "membro" })
  papel: string; // 'dono', 'membro'

  @Column({ type: "varchar", length: 20, default: "active" })
  status: string; // 'active', 'pending_approval'

  @Column({ type: "boolean", default: false })
  allow_multiple_nominations: boolean;

  @CreateDateColumn({ type: "timestamp" })
  criado_em: Date;

  @ManyToOne(() => BookClub, { onDelete: "CASCADE" })
  @JoinColumn({ name: "book_club_id" })
  book_club: BookClub;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;
}
