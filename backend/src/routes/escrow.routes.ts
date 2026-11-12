import { Router } from "express";
import {
  handlePrepareEscrow,
  handleConfirmFunding,
  handleSubmitFulfilment,
  handleApproveAndRelease,
  handleVerifyTx,
} from "../controllers/escrow.controller.js";

const router = Router();

router.post("/prepare", handlePrepareEscrow);
router.post("/:id/fund", handleConfirmFunding);
router.post("/:id/fulfil", handleSubmitFulfilment);
router.post("/:id/release", handleApproveAndRelease);
router.get("/tx/:hash/verify", handleVerifyTx);

export default router;
