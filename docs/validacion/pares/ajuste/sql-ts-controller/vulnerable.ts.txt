import { Request, Response } from "express";
import { db } from "./database";

export class ProductController {
  async getByCategory(req: Request, res: Response): Promise<void> {
    const category = req.query.category as string;
    const query = "SELECT * FROM products WHERE category = '" + category + "' ORDER BY price";
    const rows = await db.query(query);
    res.json(rows);
  }
}
