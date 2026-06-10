import { Response } from "express";
import { AuthRequest } from "../middlewares/auth";

class SSEHub {
  private subscribers = new Map<number, Set<Response>>();

  subscribe(userId: number, res: Response) {
    if (!this.subscribers.has(userId)) {
      this.subscribers.set(userId, new Set());
    }
    this.subscribers.get(userId)!.add(res);
  }

  unsubscribe(userId: number, res: Response) {
    const clients = this.subscribers.get(userId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        this.subscribers.delete(userId);
      }
    }
  }

  publish(userId: number, event: string, data: any) {
    const clients = this.subscribers.get(userId);
    if (clients) {
      // Flask JSON format has separators=(',', ':') which strips spaces. JSON.stringify does the same without indentation.
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      clients.forEach((res) => {
        try {
          res.write(payload);
        } catch (err) {
          // ignore closed connections
        }
      });
    }
  }
}

export const sseHub = new SSEHub();

export const sseHandler = (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: "Não autorizado" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  res.write(": connected\n\n");

  sseHub.subscribe(userId, res);

  const heartbeatInterval = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch (err) {
      // connection might have closed
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeatInterval);
    sseHub.unsubscribe(userId, res);
  });
};
