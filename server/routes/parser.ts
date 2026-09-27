import { Router } from "express";
import type { Request, Response } from "express";
import { parseStatement } from "../services/parser.js";
import { parseStatementInput } from "../input-schemas.js";
import { parseRequest } from "./validation.js";

const router = Router();

router.post("/parse-statement", (req: Request, res: Response) => {
  const body = parseRequest(parseStatementInput, req.body);
  const data = parseStatement(body.text, body.accountId);
  res.json({ success: true, data });
});

export const parserRouter = router;
