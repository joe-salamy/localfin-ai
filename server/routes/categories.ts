import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { categoryTypeSchema } from "../../shared/contracts/categories.js";
import { hexColorSchema } from "../../shared/validation.js";
import {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
  restoreCategory,
  createSubcategory,
  getSubcategories,
  getSubcategoriesByCategory,
  updateSubcategory,
  deleteSubcategory,
  restoreSubcategory,
} from "../services/categories.js";
import {
  finiteNumber,
  idParamSchema,
  nonEmptyString,
  parseRequest,
} from "./validation.js";

export const categoryRouter = Router();
export const subcategoryRouter = Router();
const colorSchema = hexColorSchema.nullable();
const createCategorySchema = z.object({
  name: nonEmptyString,
  type: categoryTypeSchema,
  color: colorSchema.optional(),
});
const updateCategorySchema = z
  .object({
    name: nonEmptyString.optional(),
    type: categoryTypeSchema.optional(),
    color: colorSchema.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one update field is required",
  );
const createSubcategorySchema = z.object({
  name: nonEmptyString,
  category_id: nonEmptyString,
  monthly_goal: finiteNumber.nonnegative().nullable().optional(),
  color: colorSchema.optional(),
});
const updateSubcategorySchema = z
  .object({
    name: nonEmptyString.optional(),
    category_id: nonEmptyString.optional(),
    monthly_goal: finiteNumber.nonnegative().nullable().optional(),
    color: colorSchema.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one update field is required",
  );
const categoryIdParamSchema = z.object({ categoryId: nonEmptyString });

// --- Category routes ---

categoryRouter.get("/", (_req: Request, res: Response) => {
  const data = getCategories();
  res.json({ success: true, data });
});

categoryRouter.post("/", (req: Request, res: Response) => {
  const body = parseRequest(createCategorySchema, req.body);

  const data = createCategory(body);
  res.status(201).json({ success: true, data });
});

categoryRouter.put("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);
  const body = parseRequest(updateCategorySchema, req.body);

  const data = updateCategory(params.id, body);
  res.json({ success: true, data });
});

categoryRouter.post("/:id/restore", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  const data = restoreCategory(params.id);
  res.json({ success: true, data });
});

categoryRouter.delete("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  deleteCategory(params.id);
  res.json({ success: true });
});

// --- Subcategory routes ---

subcategoryRouter.get("/", (_req: Request, res: Response) => {
  const data = getSubcategories();
  res.json({ success: true, data });
});

subcategoryRouter.get(
  "/by-category/:categoryId",
  (req: Request, res: Response) => {
    const params = parseRequest(categoryIdParamSchema, req.params);

    const data = getSubcategoriesByCategory(params.categoryId);
    res.json({ success: true, data });
  },
);

subcategoryRouter.post("/", (req: Request, res: Response) => {
  const body = parseRequest(createSubcategorySchema, req.body);

  const data = createSubcategory(body);
  res.status(201).json({ success: true, data });
});

subcategoryRouter.put("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);
  const body = parseRequest(updateSubcategorySchema, req.body);

  const data = updateSubcategory(params.id, body);
  res.json({ success: true, data });
});

subcategoryRouter.post("/:id/restore", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  const data = restoreSubcategory(params.id);
  res.json({ success: true, data });
});

subcategoryRouter.delete("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  deleteSubcategory(params.id);
  res.json({ success: true });
});
