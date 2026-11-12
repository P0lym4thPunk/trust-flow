import { Router } from "express";
import {
  handleGetAllAgreements,
  handleGetAgreementById,
  handleCreateOrUpdateAgreement,
  handleAcceptAgreement,
} from "../controllers/agreement.controller.js";

const router = Router();

router.get("/", handleGetAllAgreements);
router.get("/:id", handleGetAgreementById);
router.post("/", handleCreateOrUpdateAgreement);
router.post("/:id/accept", handleAcceptAgreement);

export default router;
