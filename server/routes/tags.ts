import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createTag,
  deleteTag,
  getTags,
  updateTag,
} from '../services/tags.js';
import { idParamSchema, nonEmptyString, parseRequest } from './validation.js';

export const tagRouter = Router();

const tagTypeSchema = z.enum(['custom', 'trip', 'event', 'person', 'reimbursable', 'tax']);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable();
const createTagSchema = z.object({
  name: nonEmptyString,
  type: tagTypeSchema.optional(),
  color: colorSchema.optional(),
});
const updateTagSchema = z.object({
  name: nonEmptyString.optional(),
  type: tagTypeSchema.optional(),
  color: colorSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one update field is required');

tagRouter.get('/', (_req: Request, res: Response) => {
  try {
    const data = getTags();
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

tagRouter.post('/', (req: Request, res: Response) => {
  try {
    const body = parseRequest(createTagSchema, req.body, res);
    if (!body) return;
    const data = createTag(body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

tagRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    const body = parseRequest(updateTagSchema, req.body, res);
    if (!params || !body) return;
    const data = updateTag(params.id, body);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

tagRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    if (!params) return;
    deleteTag(params.id);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});
