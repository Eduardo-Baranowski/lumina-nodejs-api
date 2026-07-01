import * as bcrypt from "bcryptjs";
import express from "express";
import request from "supertest";
import { authRouter } from "../src/controllers/auth";
import { User } from "../src/entities/User";
import { AppDataSource } from "../src/config/database";

jest.mock("../src/config/database", () => ({
  AppDataSource: {
    getRepository: jest.fn(),
  },
}));

const mockedGetRepository = AppDataSource.getRepository as jest.Mock;

const app = express();
app.use(express.json());
app.use("/auth", authRouter);

describe("Auth routes", () => {
  beforeEach(() => {
    mockedGetRepository.mockReset();
  });

  it("deve cadastrar um novo leitor quando o email não existir", async () => {
    const repo = {
      findOneBy: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockedGetRepository.mockReturnValue(repo);

    const res = await request(app)
      .post("/auth/register")
      .send({ nome: "Teste", email: "teste@example.com", senha: "senha123" });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Leitor cadastrado com sucesso");
    expect(repo.findOneBy).toHaveBeenCalledWith({ email: "teste@example.com" });
    expect(repo.save).toHaveBeenCalled();
  });

  it("deve retornar 400 quando o email já estiver cadastrado", async () => {
    const repo = {
      findOneBy: jest.fn().mockResolvedValue({ id: 1, email: "teste@example.com" }),
      save: jest.fn(),
    };
    mockedGetRepository.mockReturnValue(repo);

    const res = await request(app)
      .post("/auth/register")
      .send({ nome: "Teste", email: "teste@example.com", senha: "senha123" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Email já cadastrado");
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("deve retornar 400 quando campos obrigatórios estiverem ausentes no registro", async () => {
    const res = await request(app).post("/auth/register").send({ email: "teste@example.com" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Campos nome, email e senha são obrigatórios");
  });

  it("deve autenticar o usuário válido e retornar token", async () => {
    const senhaHash = bcrypt.hashSync("senha123", bcrypt.genSaltSync(10));
    const existingUser = new User();
    existingUser.id = 1;
    existingUser.nome = "Teste";
    existingUser.email = "teste@example.com";
    existingUser.senha_hash = senhaHash;
    existingUser.papel = "leitor";
    existingUser.imagem = null;

    const repo = {
      findOneBy: jest.fn().mockResolvedValue(existingUser),
    };
    mockedGetRepository.mockReturnValue(repo);

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "teste@example.com", senha: "senha123" });

    expect(res.status).toBe(200);
    expect(res.body.papel).toBe("leitor");
    expect(res.body.nome).toBe("Teste");
    expect(res.body.token_sessao).toBeTruthy();
  });

  it("deve retornar 400 quando email ou senha estiverem ausentes no login", async () => {
    const res = await request(app).post("/auth/login").send({ email: "teste@example.com" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Email e senha são obrigatórios");
  });

  it("deve retornar 401 quando credenciais forem inválidas", async () => {
    const repo = {
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    mockedGetRepository.mockReturnValue(repo);

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "teste@example.com", senha: "senha123" });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Credenciais inválidas");
  });
});
