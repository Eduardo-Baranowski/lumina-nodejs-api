import { Router, Request, Response } from "express";
import { AppDataSource } from "../config/database";
import { User } from "../entities/User";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { getImageUrl } from "../utils/image";

const PASSWORD_RESET_TOKEN_EXPIRATION = process.env.PASSWORD_RESET_TOKEN_EXPIRATION || "1h";
const PASSWORD_RESET_EMAIL_ENABLED = process.env.PASSWORD_RESET_EMAIL_ENABLED === "1";

const jwtSecret = (process.env.JWT_SECRET || "") as jwt.Secret;
const signOptions: jwt.SignOptions = {
  expiresIn: PASSWORD_RESET_TOKEN_EXPIRATION as jwt.SignOptions["expiresIn"],
};

const createPasswordResetToken = (userId: number): string => {
  return jwt.sign(
    {
      sub: String(userId),
      type: "password_reset",
    },
    jwtSecret,
    signOptions
  );
};

const decodePasswordResetToken = (token: string): { sub: string; type: string } | null => {
  try {
    const payload = jwt.verify(token, jwtSecret) as any;
    if (!payload || payload.type !== "password_reset") {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

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

authRouter.post("/password-reset/request", async (req: Request, res: Response) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ message: "Email é obrigatório" });
  }

  const userRepository = AppDataSource.getRepository(User);
  try {
    const user = await userRepository.findOneBy({ email });
    const token = user ? createPasswordResetToken(user.id) : null;
    const resetUrl = token
      ? `${process.env.BASE_URL || `http://localhost:${process.env.PORT || "5000"}`}/reset-password?token=${token}`
      : null;

    if (PASSWORD_RESET_EMAIL_ENABLED) {
      // TODO: enviar token por e-mail quando provedor de e-mail estiver configurado.
      // Neste momento, o token é retornado na resposta para permitir uso direto da API.
    }

    return res.status(200).json({
      message:
        "Se este e-mail estiver cadastrado, você receberá instruções para resetar a senha.",
      token,
      reset_url: resetUrl,
    });
  } catch (err) {
    console.error("Error during password reset request:", err);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
});

authRouter.post("/password-reset/confirm", async (req: Request, res: Response) => {
  const { token, nova_senha } = req.body || {};
  if (!token || !nova_senha) {
    return res.status(400).json({ message: "Token e nova_senha são obrigatórios" });
  }
  if (String(nova_senha).length < 6) {
    return res.status(400).json({ message: "A nova senha deve ter ao menos 6 caracteres" });
  }

  const payload = decodePasswordResetToken(String(token));
  if (!payload) {
    return res.status(400).json({ message: "Token de reset inválido ou expirado" });
  }

  const userRepository = AppDataSource.getRepository(User);
  try {
    const user = await userRepository.findOneBy({ id: Number(payload.sub) });
    if (!user) {
      return res.status(400).json({ message: "Token de reset inválido" });
    }

    const salt = bcrypt.genSaltSync(10);
    user.senha_hash = bcrypt.hashSync(String(nova_senha), salt);
    await userRepository.save(user);

    return res.status(200).json({ message: "Senha alterada com sucesso" });
  } catch (err) {
    console.error("Error during password reset confirm:", err);
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
      process.env.JWT_SECRET || "",
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
