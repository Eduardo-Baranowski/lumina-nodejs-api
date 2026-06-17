import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";

@Entity("editora")
export class Editora {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 100, unique: true })
  nome: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  imagem: string | null;

  @CreateDateColumn({ type: "timestamp" })
  criado_em: Date;
}
