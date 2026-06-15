import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from "typeorm";
import { User } from "./User";
import { Livro } from "./Livro";

@Entity("compra")
export class Compra {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  leitor_id: number;

  @Column({ type: "integer" })
  livro_id: number;

  @Column({ type: "integer", default: 1 })
  quantidade: number;

  @Column({ type: "numeric", precision: 10, scale: 2, nullable: true })
  total: string | null;

  @Column({ type: "varchar", length: 30, nullable: true, default: "confirmada" })
  status: string | null;

  @CreateDateColumn({ type: "timestamp" })
  data_compra: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "leitor_id" })
  leitor: User;

  @ManyToOne(() => Livro)
  @JoinColumn({ name: "livro_id" })
  livro: Livro;
}
