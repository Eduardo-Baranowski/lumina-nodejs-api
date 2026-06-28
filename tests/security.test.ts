import { Response } from "express";
import * as jwt from "jsonwebtoken";
import { authMiddleware, requireRole } from "../src/middlewares/auth";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";

function mockRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as Response & { statusCode?: number; body?: unknown };
}

describe("authMiddleware", () => {
  it("retorna 401 sem Authorization", () => {
    const req = { headers: {} } as any;
    const res = mockRes();
    const next = jest.fn();

    authMiddleware()(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("retorna 401 com token invalido", () => {
    const req = { headers: { authorization: "Bearer token-invalido" } } as any;
    const res = mockRes();
    const next = jest.fn();

    authMiddleware()(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("popula req.user com token valido", () => {
    const token = jwt.sign({ sub: "42", papel: "leitor", type: "access" }, JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    const res = mockRes();
    const next = jest.fn();

    authMiddleware()(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({ id: 42, papel: "leitor" });
  });

  it("permite seguir sem token quando optional=true", () => {
    const req = { headers: {} } as any;
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(true)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });
});

describe("requireRole", () => {
  it("retorna 403 quando papel nao corresponde", () => {
    const req = { user: { id: 1, papel: "leitor" } } as any;
    const res = mockRes();
    const next = jest.fn();

    requireRole("admin")(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("chama next quando papel corresponde", () => {
    const req = { user: { id: 1, papel: "editor" } } as any;
    const res = mockRes();
    const next = jest.fn();

    requireRole("editor")(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
