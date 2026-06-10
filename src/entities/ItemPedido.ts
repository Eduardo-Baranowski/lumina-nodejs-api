import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Pedido } from "./Pedido";
import { Livro } from "./Livro";

@Entity("item_pedido")
export class ItemPedido {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  pedido_id: number;

  @Column({ type: "integer" })
  livro_id: number;

  @Column({ type: "integer" })
  quantidade: number;

  @Column({ type: "numeric", precision: 10, scale: 2 })
  preco_unitario: string;

  @ManyToOne(() => Pedido, (pedido) => pedido.itens)
  @JoinColumn({ name: "pedido_id" })
  pedido: Pedido;

  @ManyToOne(() => Livro)
  @JoinColumn({ name: "livro_id" })
  livro: Livro;
}
