import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from "typeorm";
import { User } from "./User";

@Entity("friendship")
export class Friendship {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  requester_id: number;

  @Column({ type: "integer" })
  addressee_id: number;

  @Column({ type: "varchar", length: 20, default: "pending" })
  status: string; // 'pending', 'accepted', 'rejected'

  @CreateDateColumn({ type: "timestamp" })
  criado_em: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "requester_id" })
  requester: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: "addressee_id" })
  addressee: User;
}
