import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from "typeorm";
import { User } from "./User";

@Entity("follow")
export class Follow {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  follower_id: number;

  @Column({ type: "integer" })
  following_id: number;

  @CreateDateColumn({ type: "timestamp" })
  criado_em: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "follower_id" })
  follower: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: "following_id" })
  following: User;
}
