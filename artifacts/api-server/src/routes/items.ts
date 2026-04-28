import { Router, type IRouter } from "express";
import { db, itemCodesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/items", async (_req, res): Promise<void> => {
  const items = await db
    .select()
    .from(itemCodesTable)
    .orderBy(itemCodesTable.code);

  res.json(items);
});

export default router;
