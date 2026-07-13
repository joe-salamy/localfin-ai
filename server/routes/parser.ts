import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { parseStatement } from "../services/parser.js";
import { nonEmptyString, parseRequest } from "./validation.js";

const router = Router();
const parseStatementSchema = z.object({
  text: nonEmptyString.max(500_000),
  accountId: nonEmptyString,
  conversationId: nonEmptyString.optional(),
});

router.post("/parse-statement", async (req: Request, res: Response) => {
  const body = parseRequest(parseStatementSchema, req.body);


  const data = await parseStatement(
    body.text,
    body.accountId,
    body.conversationId,
  );
  res.json({ success: true, data });
});

export const parserRouter = router;
