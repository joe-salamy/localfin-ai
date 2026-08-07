import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { tagTypeSchema } from "../../shared/contracts/tags.js";
import { hexColorSchema } from "../../shared/validation.js";
import {
  createTag,
  deleteTag,
  getTags,
  restoreTag,
  updateTag,
} from "../services/tags.js";
import { idParamSchema, nonEmptyString, parseRequest } from "./validation.js";

export const tagRouter = Router();
const colorSchema = hexColorSchema.nullable();

const createTagSchema = z.object({
  name: nonEmptyString,
  type: tagTypeSchema.optional(),
  color: colorSchema.optional(),
});
const updateTagSchema = z
  .object({
    name: nonEmptyString.optional(),
    type: tagTypeSchema.optional(),
    color: colorSchema.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one update field is required",
  );

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
