import { Router, type IRouter } from "express";
import { db, vendorsTable } from "@workspace/db";
import { ilike, or, eq, and, asc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/vendors", async (req, res): Promise<void> => {
  const { search, limit, includeInvalid } = req.query as {
    search?: string;
    limit?: string;
    includeInvalid?: string;
  };
  const maxRows = Math.min(parseInt(limit ?? "30", 10), 100);
  const onlyValid = includeInvalid !== "1" && includeInvalid !== "true";

  const validFilter = onlyValid ? eq(vendorsTable.validFlg, true) : undefined;

  if (search && search.trim().length > 0) {
    const term = `%${search.trim()}%`;
    const searchFilter = or(
      ilike(vendorsTable.vendorCd, term),
      ilike(vendorsTable.vendorNm, term),
      ilike(vendorsTable.taxNo, term),
    );
    const whereClause = validFilter ? and(searchFilter, validFilter) : searchFilter;

    const vendors = await db
      .select()
      .from(vendorsTable)
      .where(whereClause)
      .orderBy(asc(vendorsTable.vendorCd))
      .limit(maxRows);
    res.json(vendors);
    return;
  }

  const baseQuery = db.select().from(vendorsTable);
  const vendors = await (validFilter ? baseQuery.where(validFilter) : baseQuery)
    .orderBy(asc(vendorsTable.vendorCd))
    .limit(maxRows);
  res.json(vendors);
});

export default router;
