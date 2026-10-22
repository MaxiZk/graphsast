import { Request, Response } from "express";
import { User } from "./models/user";

export async function resetPassword(req: Request, res: Response) {
  if (typeof req.body.token !== "string") return res.status(400).end();
  const user = await User.findOne({ resetToken: String(req.body.token) });
  if (!user) return res.status(400).json({ error: "token inválido" });
  res.json({ ok: true });
}
