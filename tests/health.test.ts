import request from "supertest";
import { app } from "../src/index";

describe("GET /health", () => {
  it("retorna status ok sem autenticacao", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.timestamp).toBeDefined();
  });
});

describe("404", () => {
  it("retorna mensagem para rota inexistente", async () => {
    const res = await request(app).get("/rota-inexistente-xyz");

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Recurso não encontrado");
  });
});
