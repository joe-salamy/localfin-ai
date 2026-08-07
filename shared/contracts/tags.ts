import { z } from "zod";

export type TagType =
  | "custom"
  | "trip"
  | "event"
  | "person"
  | "reimbursable"
  | "tax";

export const tagTypeSchema = z.enum([
  "custom",
  "trip",
  "event",
  "person",
  "reimbursable",
  "tax",
]);
export interface Tag {
  id: string;
  name: string;
  type: TagType;
  color: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface CreateTagData {
  name: string;
  type?: TagType;
  color?: string | null;
}
