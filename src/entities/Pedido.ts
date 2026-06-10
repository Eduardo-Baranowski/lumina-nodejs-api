import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany, CreateDateColumn } from "typeorm";
import { User } from "./User";
import { ItemPedido } from "./ItemPedido";

@Entity("pedido")
export class Pedido {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  leitor_id: number;

  @Column({ type: "numeric", precision: 10, scale: 2, default: "0.00" })
  total: string;

  @Column({ type: "varchar", length: 20, nullable: true, default: "pendente" })
  status: string | null;

  // Address fields (separate columns for compatibility with Python model)
  @Column({ type: "varchar", length: 255, nullable: true })
  endereco_rua: string | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  endereco_numero: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  endereco_bairro: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  endereco_cidade: string | null;

  @Column({ type: "varchar", length: 2, nullable: true })
  endereco_estado: string | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  endereco_cep: string | null;

  @Column({ type: "varchar", length: 50, nullable: true, default: "simulado" })
  metodo_pagamento: string | null;

  @CreateDateColumn({ type: "timestamp" })
  data_pedido: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "leitor_id" })
  leitor: User;

  @OneToMany(() => ItemPedido, (item) => item.pedido)
  itens: ItemPedido[];
}
