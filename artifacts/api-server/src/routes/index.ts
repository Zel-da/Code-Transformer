import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import reportsRouter from "./reports";
import itemsRouter from "./items";
import rpaRouter from "./rpa";
import masterRouter from "./master";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(reportsRouter);
router.use(itemsRouter);
router.use(rpaRouter);
router.use(masterRouter);

export default router;
