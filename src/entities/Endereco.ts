import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from "typeorm";
import { User } from "./User";

@Entity("endereco")
export class Endereco {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  user_id: number;

  @Column({ type: "varchar", length: 255 })
  label: string;

  @Column({ type: "varchar", length: 255 })
  rua: string;

  @Column({ type: "varchar", length: 50 })
  numero: string;

  @Column({ type: "varchar", length: 255 })
  bairro: string;

  @Column({ type: "varchar", length: 255 })
  cidade: string;

  @Column({ type: "varchar", length: 100 })
  estado: string;

  @Column({ type: "varchar", length: 20 })
  cep: string;

  @CreateDateColumn({ type: "timestamp" })
  criado_em: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user: User;
}
