import { Router, type IRouter } from "express";
import healthRouter from "./health";
import teamsRouter from "./teams";
import ticketsRouter from "./tickets";
import dashboardRouter from "./dashboard";
import eventRouter from "./event";
import pagerRouter from "./pager";

const router: IRouter = Router();

router.use(healthRouter);
router.use(teamsRouter);
router.use(ticketsRouter);
router.use(dashboardRouter);
router.use(eventRouter);
router.use(pagerRouter);

export default router;
