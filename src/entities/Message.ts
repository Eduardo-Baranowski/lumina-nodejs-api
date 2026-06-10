import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from "typeorm";
import { User } from "./User";

@Entity("message")
export class Message {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  sender_id: number;

  @Column({ type: "integer" })
  receiver_id: number;

  @Column({ type: "text" })
  conteudo: string;

  @Column({ type: "boolean", default: false })
  lida: boolean;

  @CreateDateColumn({ type: "timestamp" })
  data_envio: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "sender_id" })
  sender: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: "receiver_id" })
  receiver: User;
}
