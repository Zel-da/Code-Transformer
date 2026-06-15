import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import reportsRouter from "./reports";
import itemsRouter from "./items";
import vendorsRouter from "./vendors";
import rpaRouter from "./rpa";
import masterRouter from "./master";
import authRouter from "./auth";
import usersRouter from "./users";
import erpRouter from "./erp";
import commentsRouter from "./comments";
import webhooksRouter from "./webhooks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(reportsRouter);
router.use(itemsRouter);
router.use(vendorsRouter);
router.use(rpaRouter);
router.use(masterRouter);
router.use(erpRouter);
router.use(commentsRouter);
router.use(webhooksRouter);

export default router;
