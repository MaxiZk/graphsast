import { Request, Response } from "express";
import { User } from "./models/user";

export async function resetPassword(req: Request, res: Response) {
  const user = await User.findOne({ resetToken: req.body.token });
  if (!user) return res.status(400).json({ error: "token inválido" });
  res.json({ ok: true });
}
