import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./User";

@Entity("book_club")
export class BookClub {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 100 })
  nome: string;

  @Column({ type: "text", nullable: true })
  descricao: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  imagem: string | null;

  @Column({ type: "boolean", default: false })
  privado: boolean;

  @Column({ type: "varchar", length: 20, unique: true, nullable: true })
  convite_codigo: string | null;

  @Column({ type: "integer" })
  criado_por_id: number;

  @CreateDateColumn({ type: "timestamp" })
  criado_em: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "criado_por_id" })
  criado_por: User;
}
