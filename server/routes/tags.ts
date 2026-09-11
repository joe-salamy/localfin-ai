import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { tagTypeSchema } from "../../shared/contracts/tags.js";
import {
  createTag,
  deleteTag,
  getTags,
  restoreTag,
  updateTag,
} from "../services/tags.js";
import { colorSchemaOptional, idParamSchema, nonEmptyString, nonEmptyUpdate, parseRequest } from "./validation.js";

export const tagRouter = Router();
const createTagSchema = z.object({
  name: nonEmptyString,
  type: tagTypeSchema.optional(),
  color: colorSchemaOptional,
});
const updateTagSchema = nonEmptyUpdate({
    name: nonEmptyString.optional(),
    type: tagTypeSchema.optional(),
    color: colorSchemaOptional,
});

tagRouter.get("/", (_req: Request, res: Response) => {
  const data = getTags();
  res.json({ success: true, data });
});

tagRouter.post("/", (req: Request, res: Response) => {
  const body = parseRequest(createTagSchema, req.body);

  const data = createTag(body);
  res.status(201).json({ success: true, data });
});

tagRouter.put("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);
  const body = parseRequest(updateTagSchema, req.body);

  const data = updateTag(params.id, body);
  res.json({ success: true, data });
});

tagRouter.post("/:id/restore", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  const data = restoreTag(params.id);
  res.json({ success: true, data });
});

tagRouter.delete("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  deleteTag(params.id);
  res.json({ success: true });
});
