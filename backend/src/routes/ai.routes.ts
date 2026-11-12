import { Router } from "express";
import { handleDraft, handleCheck } from "../controllers/ai.controller.js";

const router = Router();

router.post("/draft", handleDraft);
router.post("/check", handleCheck);

export default router;
