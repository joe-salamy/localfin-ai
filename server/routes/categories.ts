import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
  createSubcategory,
  getSubcategories,
  getSubcategoriesByCategory,
  updateSubcategory,
  deleteSubcategory,
} from '../services/categories.js';
import { finiteNumber, idParamSchema, nonEmptyString, parseRequest } from './validation.js';

export const categoryRouter = Router();
export const subcategoryRouter = Router();
const categoryTypeSchema = z.enum(['income', 'expense']);
const createCategorySchema = z.object({
  name: nonEmptyString,
  type: categoryTypeSchema,
});
const updateCategorySchema = z.object({
  name: nonEmptyString.optional(),
  type: categoryTypeSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one update field is required');
const createSubcategorySchema = z.object({
  name: nonEmptyString,
  category_id: nonEmptyString,
  monthly_goal: finiteNumber.nonnegative().nullable().optional(),
});
const updateSubcategorySchema = z.object({
  name: nonEmptyString.optional(),
  category_id: nonEmptyString.optional(),
  monthly_goal: finiteNumber.nonnegative().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one update field is required');
const categoryIdParamSchema = z.object({ categoryId: nonEmptyString });

// --- Category routes ---

categoryRouter.get('/', (_req: Request, res: Response) => {
  try {
    const data = getCategories();
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

categoryRouter.post('/', (req: Request, res: Response) => {
  try {
    const body = parseRequest(createCategorySchema, req.body, res);
    if (!body) return;
    const data = createCategory(body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

categoryRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    const body = parseRequest(updateCategorySchema, req.body, res);
    if (!params || !body) return;
    const data = updateCategory(params.id, body);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

categoryRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    if (!params) return;
    deleteCategory(params.id);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

// --- Subcategory routes ---

subcategoryRouter.get('/', (_req: Request, res: Response) => {
  try {
    const data = getSubcategories();
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

subcategoryRouter.get('/by-category/:categoryId', (req: Request, res: Response) => {
  try {
    const params = parseRequest(categoryIdParamSchema, req.params, res);
    if (!params) return;
    const data = getSubcategoriesByCategory(params.categoryId);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

subcategoryRouter.post('/', (req: Request, res: Response) => {
  try {
    const body = parseRequest(createSubcategorySchema, req.body, res);
    if (!body) return;
    const data = createSubcategory(body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

subcategoryRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    const body = parseRequest(updateSubcategorySchema, req.body, res);
    if (!params || !body) return;
    const data = updateSubcategory(params.id, body);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

subcategoryRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    if (!params) return;
    deleteSubcategory(params.id);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});
