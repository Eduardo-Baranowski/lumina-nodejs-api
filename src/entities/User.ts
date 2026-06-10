import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";
import * as bcrypt from "bcryptjs";

@Entity("user")
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 100 })
  nome: string;

  @Column({ type: "varchar", length: 100, unique: true })
  email: string;

  @Column({ type: "varchar", length: 255 })
  senha_hash: string;

  @Column({ type: "varchar", length: 20 })
  papel: string; // 'admin', 'editor', 'leitor'

  @Column({ type: "varchar", length: 255, nullable: true })
  imagem: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  headline: string | null;

  @Column({ type: "text", nullable: true })
  bio: string | null;

  verificar_senha(senhaPlana: string): boolean {
    return bcrypt.compareSync(senhaPlana, this.senha_hash);
  }
}
