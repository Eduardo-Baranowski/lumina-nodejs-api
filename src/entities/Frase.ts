import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";

@Entity("frase")
export class Frase {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "text" })
  texto: string;

  @Column({ type: "varchar", length: 200, nullable: true })
  autor: string | null;

  @Column({ type: "varchar", length: 200, nullable: true })
  livro: string | null;

  @Column({ type: "boolean", default: true })
  ativo: boolean;

  @CreateDateColumn({ type: "timestamp" })
  criado_em: Date;
}
