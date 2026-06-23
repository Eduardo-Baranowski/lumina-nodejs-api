import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Livro } from "./Livro";
import { Autor } from "./Autor";

@Entity("livro_autor")
export class LivroAutor {
  @PrimaryColumn({ type: "integer" })
  livro_id: number;

  @PrimaryColumn({ type: "integer" })
  autor_id: number;

  @Column({ type: "smallint", default: 0 })
  ordem: number;

  @ManyToOne(() => Livro, { onDelete: "CASCADE" })
  @JoinColumn({ name: "livro_id" })
  livro: Livro;

  @ManyToOne(() => Autor, { onDelete: "CASCADE" })
  @JoinColumn({ name: "autor_id" })
  autor: Autor;
}
