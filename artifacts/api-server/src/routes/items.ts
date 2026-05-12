import { Router, type IRouter } from "express";
import { db, itemCodesTable } from "@workspace/db";
import { ilike, or, asc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/items", async (req, res): Promise<void> => {
  const { search, limit } = req.query as { search?: string; limit?: string };
  const maxRows = Math.min(parseInt(limit ?? "30", 10), 100);

  if (search && search.trim().length > 0) {
    const term = `%${search.trim()}%`;
    const items = await db
      .select()
      .from(itemCodesTable)
      .where(or(ilike(itemCodesTable.code, term), ilike(itemCodesTable.name, term)))
      .orderBy(asc(itemCodesTable.code))
      .limit(maxRows);
    res.json(items);
    return;
  }

  const items = await db
    .select()
    .from(itemCodesTable)
    .orderBy(asc(itemCodesTable.code))
    .limit(maxRows);
  res.json(items);
});

export default router;
