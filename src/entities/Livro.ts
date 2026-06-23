import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from "typeorm";
import { User } from "./User";
import { Editora } from "./Editora";

@Entity("livro")
export class Livro {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer", nullable: true })
  editor_id: number | null;

  @Column({ type: "integer", nullable: true })
  editora_id: number | null;

  @Column({ type: "integer", nullable: true })
  submitted_by_id: number | null;

  @Column({ type: "varchar", length: 200 })
  titulo: string;

  @Column({ type: "varchar", length: 200 })
  autor: string;

  @Column({ type: "varchar", length: 20, nullable: true })
  isbn: string | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  open_library_key: string | null;

  @Column({ type: "numeric", precision: 10, scale: 2, default: "0.00" })
  preco: string;

  @Column({ type: "integer", default: 0 })
  estoque: number;

  @Column({ type: "varchar", length: 100, nullable: true })
  genero: string | null;

  @Column({ type: "varchar", length: 30, nullable: true, default: "novo" })
  condicao: string | null;

  @Column({ type: "text", nullable: true })
  descricao: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  imagem: string | null;

  @Column({ type: "integer", default: 0 })
  paginas: number;

  @CreateDateColumn({ type: "timestamp" })
  data_cadastro: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "editor_id" })
  editor: User;

  @ManyToOne(() => Editora)
  @JoinColumn({ name: "editora_id" })
  editora: Editora;

  @ManyToOne(() => User)
  @JoinColumn({ name: "submitted_by_id" })
  submittedBy: User;
}
