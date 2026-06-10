import { Router, Request, Response } from "express";
import { AppDataSource } from "../config/database";
import { User } from "../entities/User";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { getImageUrl } from "../utils/image";

export const authRouter = Router();

authRouter.post("/register", async (req: Request, res: Response) => {
  const { nome, email, senha } = req.body || {};

  if (!nome || !email || !senha) {
    return res.status(400).json({
      message: "Campos nome, email e senha são obrigatórios",
    });
  }

  const userRepository = AppDataSource.getRepository(User);

  try {
    const userExists = await userRepository.findOneBy({ email });
    if (userExists) {
      return res.status(400).json({ message: "Email já cadastrado" });
    }

    const salt = bcrypt.genSaltSync(10);
    const senha_hash = bcrypt.hashSync(senha, salt);

    const newUser = new User();
    newUser.nome = nome;
    newUser.email = email;
    newUser.senha_hash = senha_hash;
    newUser.papel = "leitor";

    await userRepository.save(newUser);

    return res.status(201).json({
      message: "Leitor cadastrado com sucesso",
    });
  } catch (err) {
    console.error("Error during register:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

authRouter.post("/login", async (req: Request, res: Response) => {
  const { email, senha } = req.body || {};

  if (!email || !senha) {
    return res.status(400).json({ message: "Email e senha são obrigatórios" });
  }

  const userRepository = AppDataSource.getRepository(User);

  try {
    const user = await userRepository.findOneBy({ email });
    if (!user || !user.verificar_senha(senha)) {
      return res.status(401).json({ message: "Credenciais inválidas" });
    }

    const token_sessao = jwt.sign(
      {
        sub: String(user.id),
        papel: user.papel,
        type: "access",
      },
      process.env.JWT_SECRET_KEY || "",
      {
        expiresIn: "30d", // Generous token expiration for mobile app
      }
    );

    return res.status(200).json({
      token_sessao,
      papel: user.papel,
      nome: user.nome,
      imagem_url: getImageUrl(req, user.imagem),
    });
  } catch (err) {
    console.error("Error during login:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});
