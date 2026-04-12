import { Router } from 'express';
import type { Request, Response } from 'express';
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

export const categoryRouter = Router();
export const subcategoryRouter = Router();

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
    const data = createCategory(req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

categoryRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const data = updateCategory(req.params.id as string, req.body);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

categoryRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    deleteCategory(req.params.id as string);
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
    const data = getSubcategoriesByCategory(req.params.categoryId as string);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

subcategoryRouter.post('/', (req: Request, res: Response) => {
  try {
    const data = createSubcategory(req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

subcategoryRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const data = updateSubcategory(req.params.id as string, req.body);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

subcategoryRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    deleteSubcategory(req.params.id as string);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});
