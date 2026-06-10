import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from "typeorm";
import { User } from "./User";
import { Livro } from "./Livro";

@Entity("request")
export class Request {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  leitor_id: number;

  @Column({ type: "integer" })
  editor_id: number;

  @Column({ type: "integer", nullable: true })
  livro_id: number | null;

  @Column({ type: "text" })
  conteudo: string;

  @Column({ type: "text", nullable: true })
  resposta: string | null;

  @Column({ type: "varchar", length: 20, default: "pendente" })
  status: string;

  @CreateDateColumn({ type: "timestamp" })
  data_criacao: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "leitor_id" })
  leitor: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: "editor_id" })
  editor: User;

  @ManyToOne(() => Livro)
  @JoinColumn({ name: "livro_id" })
  livro: Livro | null;
}
