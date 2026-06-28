import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "nacionalidade" })
export class Nacionalidade {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 255, unique: true })
  nome: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  flag: string | null;

  @CreateDateColumn({ name: "criado_em" })
  criado_em: Date;
}
