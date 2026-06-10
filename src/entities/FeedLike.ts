import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from "typeorm";
import { User } from "./User";
import { Leitura } from "./Leitura";

@Entity("feed_like")
export class FeedLike {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  user_id: number;

  @Column({ type: "integer" })
  leitura_id: number;

  @CreateDateColumn({ type: "timestamp" })
  criado_em: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "user_id" })
  user: User;

  @ManyToOne(() => Leitura)
  @JoinColumn({ name: "leitura_id" })
  leitura: Leitura;
}
