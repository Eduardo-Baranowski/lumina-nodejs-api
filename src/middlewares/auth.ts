import { Request, Response, NextFunction } from "express";
import * as jwt from "jsonwebtoken";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    papel: string;
  };
}

export const authMiddleware = (optional = false) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      if (optional) {
        return next();
      }
      return res.status(401).json({
        message: "Missing Authorization Header",
        msg: "Missing Authorization Header",
      });
    }

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.substring(7)
      : authHeader;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as any;
      req.user = {
        id: parseInt(decoded.sub),
        papel: decoded.papel,
      };
      next();
    } catch (err) {
      if (optional) {
        return next();
      }
      return res.status(401).json({
        message: "Invalid or expired token",
        msg: "Invalid or expired token",
      });
    }
  };
};

export const requireRole = (role: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || req.user.papel !== role) {
      return res.status(403).json({
        message: "Acesso Negado",
        msg: "Acesso Negado",
      });
    }
    next();
  };
};
