import { Request, Response } from "express";
import { db } from "./database";

export class ProductController {
  async getByCategory(req: Request, res: Response): Promise<void> {
    const category = req.query.category as string;
    const query = "SELECT * FROM products WHERE category = ? ORDER BY price";
    const rows = await db.query(query, [category]);
    res.json(rows);
  }
}
