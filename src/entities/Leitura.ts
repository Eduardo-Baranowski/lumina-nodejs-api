import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { User } from "./User";
import { Livro } from "./Livro";

@Entity("leitura")
export class Leitura {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  leitor_id: number;

  @Column({ type: "integer" })
  livro_id: number;

  @Column({ type: "varchar", length: 30 })
  status: string; // 'lendo', 'lido', 'quero_ler'

  @Column({ type: "integer", nullable: true })
  nota: number | null;

  @Column({ type: "text", nullable: true })
  comentario: string | null;

  @Column({ type: "integer", default: 0 })
  paginas_lidas: number;

  @CreateDateColumn({ type: "timestamp" })
  criado_em: Date;

  @UpdateDateColumn({ type: "timestamp", nullable: true })
  atualizado_em: Date | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: "leitor_id" })
  leitor: User;

  @ManyToOne(() => Livro)
  @JoinColumn({ name: "livro_id" })
  livro: Livro;
}
