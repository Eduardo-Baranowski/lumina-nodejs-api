import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";

@Entity("autor")
export class Autor {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 200 })
  nome: string;

  @Column({ type: "varchar", length: 220, unique: true })
  slug: string;

  @Column({ type: "text", nullable: true })
  bio: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  imagem: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  nacionalidade: string | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  open_library_key: string | null;

  @CreateDateColumn({ type: "timestamp" })
  criado_em: Date;
}
