import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { getDb } from "../server/db/index.js";
import { OperationalError } from "../server/errors.js";
import {
  createCategory,
  createSubcategory,
  deleteCategory,
  countSubcategoryTransactions,
  deleteSubcategory,
  getCategories,
  getSubcategories,
  updateCategory,
  updateSubcategory,
} from "../server/services/categories.js";
import { HEX_COLOR_PATTERN } from "../shared/validation.js";
import type { CategoryType } from "../shared/contracts/index.js";
import { computeTaxonomyFingerprint } from "./export-taxonomy-ods.js";

export interface ParsedTaxonomyWorkbook {
  meta: Map<string, string>;
  categoriesGrid: unknown[][];
  subcategoriesGrid: unknown[][];
}

export interface TaxonomyPending {
  categoryCreates: Array<{
    rowNumber: number;
    name: string;
    type: string;
    color: string | null;
  }>;
  categoryUpdates: Array<{
    rowNumber: number;
    id: string;
    name?: string;
    type?: string;
    color?: string | null;
  }>;
  categoryDeletes: string[];
  subcategoryCreates: Array<{
    rowNumber: number;
    name: string;
    categoryLabel: string;
    categoryId: string | null;
    monthlyGoal: number | null;
    color: string | null;
  }>;
  subcategoryUpdates: Array<{
    rowNumber: number;
    id: string;
    name?: string;
    categoryId?: string;
    monthlyGoal?: number | null;
    color?: string | null;
  }>;
  subcategoryDeletes: string[];
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).trim();
}

function cellAmount(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseMonthlyGoal(value: unknown): {
  valid: boolean;
  value: number | null;
} {
  if (value == null) return { valid: true, value: null };
  if (typeof value === "string" && value.trim() === "") {
    return { valid: true, value: null };
  }
  const amount = cellAmount(value);
  if (amount == null || !Number.isFinite(amount) || amount < 0) {
    return { valid: false, value: null };
  }
  return { valid: true, value: amount };
}

export function assertFodsCellBalance(xml: string): void {
  const opens = xml.match(/<table:table-cell(\s[^>]*[^/])?>/g) ?? [];
  const closes = xml.match(/<\/table:table-cell>/g) ?? [];
  if (opens.length !== closes.length) {
    throw new Error(
      `Malformed spreadsheet XML: ${opens.length} table cells opened but ${closes.length} closed; applied zero rows`,
    );
  }
}

export function taxonomyApplyUsage(): string {
  return "Usage: taxonomy:apply <edited.fods|edited.ods> [--dry-run]";
}

export function parseTaxonomyApplyArgs(
  argv: string[],
): { input: string; dryRun: boolean } | null {
  let input: string | null = null;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") return null;
    else if (arg.startsWith("--")) return null;
    else if (input == null) input = arg;
    else return null;
  }
  if (!input) return null;
  return { input, dryRun };
}

function findSheet(
  workbook: XLSX.WorkBook,
  name: string,
): XLSX.WorkSheet | null {
  const found =
    workbook.SheetNames.find((n) => n.toLowerCase() === name.toLowerCase()) ??
    null;
  if (!found) return null;
  return workbook.Sheets[found] ?? null;
}

function gridOf(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
}

export function parseTaxonomyWorkbook(
  inputPath: string,
): ParsedTaxonomyWorkbook {
  const resolved = path.resolve(inputPath);
  if (resolved.toLowerCase().endsWith(".fods")) {
    assertFodsCellBalance(readFileSync(resolved, "utf8"));
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.readFile(resolved);
  } catch (cause) {
    throw new Error(`Cannot read spreadsheet: ${resolved} :: ${String(cause)}`);
  }

  const metaSheet = findSheet(workbook, "_meta");
  const categoriesSheet = findSheet(workbook, "Categories");
  const subcategoriesSheet = findSheet(workbook, "Subcategories");

  if (!categoriesSheet) {
    throw new Error(`Sheet "Categories" not found in ${resolved}`);
  }
  if (!subcategoriesSheet) {
    throw new Error(`Sheet "Subcategories" not found in ${resolved}`);
  }

  const meta = new Map<string, string>();
  if (metaSheet) {
    const metaGrid = gridOf(metaSheet);
    for (const row of metaGrid.slice(1)) {
      const key = cellText(row[0]).toLowerCase();
      if (!key) continue;
      meta.set(key, cellText(row[1]));
    }
  }
  if (!metaSheet || !meta.get("fingerprint") || !meta.get("created_at")) {
    throw new Error(
      `Sheet "_meta" is missing required keys (fingerprint, created_at)`,
    );
  }

  const categoriesGrid = gridOf(categoriesSheet);
  const subcategoriesGrid = gridOf(subcategoriesSheet);

  const requireColumns = (
    sheetName: string,
    grid: unknown[][],
    required: string[],
  ): void => {
    const header = (grid[0] ?? []).map((h) => cellText(h).toLowerCase());
    const missing = required.filter((c) => !header.includes(c));
    if (missing.length > 0) {
      throw new Error(
        `Sheet "${sheetName}" is missing required columns (${required.join(", ")})`,
      );
    }
  };

  requireColumns("Categories", categoriesGrid, [
    "__id",
    "name",
    "type",
    "color",
    "__delete",
  ]);
  requireColumns("Subcategories", subcategoriesGrid, [
    "__id",
    "name",
    "category",
    "__category_id",
    "monthly_goal",
    "color",
    "__delete",
  ]);
  return { meta, categoriesGrid, subcategoriesGrid };
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => cell == null || String(cell).trim() === "");
}

function localDatePart(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function localTimePart(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}${m}${s}`;
}

export function validateTaxonomyRows(
  parsed: ParsedTaxonomyWorkbook,
): TaxonomyPending {
  void getDb();
  const liveCategories = getCategories();
  const liveSubcategories = getSubcategories();
  const liveFingerprint = computeTaxonomyFingerprint(
    liveCategories,
    liveSubcategories,
  );
  const fileFingerprint = parsed.meta.get("fingerprint") ?? "";
  if (fileFingerprint !== liveFingerprint) {
    throw new Error(
      "Taxonomy file is stale (DB changed since export); re-run taxonomy:export",
    );
  }

  const errors: string[] = [];
  const pending: TaxonomyPending = {
    categoryCreates: [],
    categoryUpdates: [],
    categoryDeletes: [],
    subcategoryCreates: [],
    subcategoryUpdates: [],
    subcategoryDeletes: [],
  };

  const categoriesById = new Map(liveCategories.map((c) => [c.id, c] as const));
  const subcategoriesById = new Map(
    liveSubcategories.map((s) => [s.id, s] as const),
  );
  const categoryTypeById = new Map(
    liveCategories.map((c) => [c.id, c.type] as const),
  );

  const liveCategoryNames = new Map(
    liveCategories.map((c) => [c.name, c.id] as const),
  );
  const liveSubcategoryNames = new Map(
    liveSubcategories.map((s) => [s.name, s.id] as const),
  );
  const seenNewNames = new Map<string, string>();
  const createdCategoryCounts = new Map<string, number>();
  const createdCategoryTypeByName = new Map<string, string>();

  const claimName = (
    sheet: string,
    rowNumber: number,
    idLabel: string,
    name: string,
    excludeCategoryId?: string,
    excludeSubcategoryId?: string,
  ): boolean => {
    const seen = seenNewNames.get(name);
    if (seen) {
      errors.push(
        `${sheet} row ${rowNumber} (${idLabel}): name "${name}" already exists (${seen})`,
      );
      return false;
    }
    const liveCat = liveCategoryNames.get(name);
    if (liveCat && liveCat !== excludeCategoryId) {
      errors.push(
        `${sheet} row ${rowNumber} (${idLabel}): name "${name}" already exists`,
      );
      return false;
    }
    const liveSub = liveSubcategoryNames.get(name);
    if (liveSub && liveSub !== excludeSubcategoryId) {
      errors.push(
        `${sheet} row ${rowNumber} (${idLabel}): name "${name}" already exists`,
      );
      return false;
    }
    seenNewNames.set(name, `${sheet} row ${rowNumber}`);
    return true;
  };

  // === Categories ===
  {
    const grid = parsed.categoriesGrid;
    const header = (grid[0] ?? []).map((h) => cellText(h).toLowerCase());
    const col = (n: string): number => header.indexOf(n);
    const idCol = col("__id");
    const nameCol = col("name");
    const typeCol = col("type");
    const colorCol = col("color");
    const deleteCol = col("__delete");
    grid.slice(1).forEach((row, index) => {
      const rowNumber = index + 2;
      if (isBlankRow(row)) return;
      const id = cellText(row[idCol]);
      const idLabel = id || "new";
      const deleteRaw = cellText(row[deleteCol]);
      if (deleteRaw !== "" && deleteRaw.toLowerCase() !== "x") {
        errors.push(
          `Categories row ${rowNumber} (${idLabel}): invalid __delete "${deleteRaw}" (expected "x" or empty)`,
        );
        return;
      }
      const isDelete = deleteRaw.toLowerCase() === "x";
      if (isDelete) {
        if (!id) {
          errors.push(
            `Categories row ${rowNumber} (new): __delete requires an existing __id`,
          );
          return;
        }
        const live = categoriesById.get(id);
        if (!live) {
          errors.push(`Categories row ${rowNumber} (${id}): not found`);
          return;
        }
        if (live.is_system) {
          errors.push(
            `Categories row ${rowNumber} (${id}): Cannot delete system categories`,
          );
          return;
        }
        pending.categoryDeletes.push(id);
        return;
      }
      const name = cellText(row[nameCol]);
      const typeRaw = cellText(row[typeCol]).toLowerCase();
      const colorRaw = cellText(row[colorCol]);
      if (!id) {
        if (!name) {
          errors.push(
            `Categories row ${rowNumber} (new): name is required`,
          );
          return;
        }
        if (typeRaw !== "income" && typeRaw !== "expense") {
          errors.push(
            `Categories row ${rowNumber} (new): type must be income or expense`,
          );
          return;
        }
        if (colorRaw !== "" && !HEX_COLOR_PATTERN.test(colorRaw)) {
          errors.push(
            `Categories row ${rowNumber} (new): invalid color "${colorRaw}"`,
          );
          return;
        }
        if (!claimName("Categories", rowNumber, "new", name)) return;
        pending.categoryCreates.push({
          rowNumber,
          name,
          type: typeRaw,
          color: colorRaw === "" ? null : colorRaw,
        });
        createdCategoryCounts.set(
          name,
          (createdCategoryCounts.get(name) ?? 0) + 1,
        );
        createdCategoryTypeByName.set(name, typeRaw);
        return;
      }
      const live = categoriesById.get(id);
      if (!live) {
        errors.push(`Categories row ${rowNumber} (${id}): not found`);
        return;
      }
      if (!name) {
        errors.push(`Categories row ${rowNumber} (${id}): name is required`);
        return;
      }
      if (typeRaw !== "income" && typeRaw !== "expense") {
        errors.push(
          `Categories row ${rowNumber} (${id}): type must be income or expense`,
        );
        return;
      }
      if (colorRaw !== "" && !HEX_COLOR_PATTERN.test(colorRaw)) {
        errors.push(
          `Categories row ${rowNumber} (${id}): invalid color "${colorRaw}"`,
        );
        return;
      }
      const nameEdit = name !== live.name ? name : undefined;
      const typeEdit = typeRaw !== live.type ? typeRaw : undefined;
      const liveColor = live.color ?? "";
      const colorEdit =
        colorRaw !== liveColor
          ? colorRaw === ""
            ? null
            : colorRaw
          : undefined;
      const hasColorEdit = colorRaw !== liveColor;
      if (
        live.is_system &&
        (nameEdit !== undefined || typeEdit !== undefined)
      ) {
        errors.push(
          `Categories row ${rowNumber} (${id}): Cannot update system categories`,
        );
        return;
      }
      if (typeEdit !== undefined) {
        const db = getDb();
        const activeSub = db
          .prepare(
            "SELECT 1 FROM subcategories WHERE category_id = ? AND deleted_at IS NULL LIMIT 1",
          )
          .get(id);
        const txn = db
          .prepare(
            `SELECT 1 FROM transactions t JOIN subcategories s ON s.id = t.subcategory_id WHERE s.category_id = ? AND t.deleted_at IS NULL LIMIT 1`,
          )
          .get(id);
        if (activeSub || txn) {
          errors.push(
            `Categories row ${rowNumber} (${id}): Cannot change category type while subcategories or transactions exist`,
          );
          return;
        }
      }
      if (
        nameEdit !== undefined &&
        !claimName("Categories", rowNumber, id, nameEdit, id, undefined)
      ) {
        return;
      }
      if (
        nameEdit === undefined &&
        typeEdit === undefined &&
        !hasColorEdit
      ) {
        return;
      }
      const update: TaxonomyPending["categoryUpdates"][number] = {
        rowNumber,
        id,
      };
      if (nameEdit !== undefined) update.name = nameEdit;
      if (typeEdit !== undefined) update.type = typeEdit;
      if (hasColorEdit) update.color = colorEdit ?? null;
      pending.categoryUpdates.push(update);
    });
  }

  // === Subcategories ===
  {
    const grid = parsed.subcategoriesGrid;
    const header = (grid[0] ?? []).map((h) => cellText(h).toLowerCase());
    const col = (n: string): number => header.indexOf(n);
    const idCol = col("__id");
    const nameCol = col("name");
    const categoryCol = col("category");
    const categoryIdCol = col("__category_id");
    const goalCol = col("monthly_goal");
    const colorCol = col("color");
    const deleteCol = col("__delete");

    const resolveParentForCreate = (
      rowNumber: number,
      idLabel: string,
      categoryDisplay: string,
      categoryIdCell: string,
    ): { categoryId: string | null; categoryLabel: string } | null => {
      if (categoryIdCell !== "") {
        const live = categoriesById.get(categoryIdCell);
        if (!live) {
          errors.push(
            `Subcategories row ${rowNumber} (${idLabel}): unknown category "${categoryIdCell}"`,
          );
          return null;
        }
        return { categoryId: live.id, categoryLabel: categoryDisplay };
      }
      const createdCount = createdCategoryCounts.get(categoryDisplay) ?? 0;
      if (createdCount === 1) {
        return { categoryId: null, categoryLabel: categoryDisplay };
      }
      if (createdCount > 1) {
        errors.push(
          `Subcategories row ${rowNumber} (${idLabel}): ambiguous category "${categoryDisplay}"`,
        );
        return null;
      }
      const liveMatches = liveCategories.filter(
        (c) => c.name === categoryDisplay,
      );
      if (liveMatches.length === 1 && liveMatches[0]) {
        return {
          categoryId: liveMatches[0].id,
          categoryLabel: categoryDisplay,
        };
      }
      errors.push(
        `Subcategories row ${rowNumber} (${idLabel}): unknown category "${categoryDisplay || categoryIdCell}"`,
      );
      return null;
    };

    grid.slice(1).forEach((row, index) => {
      const rowNumber = index + 2;
      if (isBlankRow(row)) return;
      const id = cellText(row[idCol]);
      const idLabel = id || "new";
      const deleteRaw = cellText(row[deleteCol]);
      if (deleteRaw !== "" && deleteRaw.toLowerCase() !== "x") {
        errors.push(
          `Subcategories row ${rowNumber} (${idLabel}): invalid __delete "${deleteRaw}" (expected "x" or empty)`,
        );
        return;
      }
      const isDelete = deleteRaw.toLowerCase() === "x";
      if (isDelete) {
        if (!id) {
          errors.push(
            `Subcategories row ${rowNumber} (new): __delete requires an existing __id`,
          );
          return;
        }
        const live = subcategoriesById.get(id);
        if (!live) {
          errors.push(`Subcategories row ${rowNumber} (${id}): not found`);
          return;
        }
        if (live.is_system) {
          errors.push(
            `Subcategories row ${rowNumber} (${id}): Cannot delete system subcategories`,
          );
          return;
        }
        const transactionCount = countSubcategoryTransactions(id);
        if (transactionCount > 0) {
          errors.push(
            `Subcategories row ${rowNumber} (${id}): has ${transactionCount} transaction(s); recategorize them before deleting`,
          );
          return;
        }
        pending.subcategoryDeletes.push(id);
        return;
      }

      const name = cellText(row[nameCol]);
      const categoryDisplay = cellText(row[categoryCol]);
      const categoryIdCell = cellText(row[categoryIdCol]);
      const colorRaw = cellText(row[colorCol]);
      const goalParsed = parseMonthlyGoal(row[goalCol]);

      if (!id) {
        if (!name) {
          errors.push(
            `Subcategories row ${rowNumber} (new): name is required`,
          );
          return;
        }
        const parent = resolveParentForCreate(
          rowNumber,
          "new",
          categoryDisplay,
          categoryIdCell,
        );
        if (!parent) return;
        if (!goalParsed.valid) {
          errors.push(
            `Subcategories row ${rowNumber} (new): monthly_goal must be a non-negative number or empty`,
          );
          return;
        }
        if (colorRaw !== "" && !HEX_COLOR_PATTERN.test(colorRaw)) {
          errors.push(
            `Subcategories row ${rowNumber} (new): invalid color "${colorRaw}"`,
          );
          return;
        }
        if (!claimName("Subcategories", rowNumber, "new", name)) return;
        pending.subcategoryCreates.push({
          rowNumber,
          name,
          categoryLabel: parent.categoryLabel,
          categoryId: parent.categoryId,
          monthlyGoal: goalParsed.value,
          color: colorRaw === "" ? null : colorRaw,
        });
        return;
      }

      const live = subcategoriesById.get(id);
      if (!live) {
        errors.push(`Subcategories row ${rowNumber} (${id}): not found`);
        return;
      }
      if (!name) {
        errors.push(
          `Subcategories row ${rowNumber} (${id}): name is required`,
        );
        return;
      }
      if (!goalParsed.valid) {
        errors.push(
          `Subcategories row ${rowNumber} (${id}): monthly_goal must be a non-negative number or empty`,
        );
        return;
      }
      if (colorRaw !== "" && !HEX_COLOR_PATTERN.test(colorRaw)) {
        errors.push(
          `Subcategories row ${rowNumber} (${id}): invalid color "${colorRaw}"`,
        );
        return;
      }
      const nameEdit = name !== live.name ? name : undefined;
      let categoryEdit: string | undefined;
      if (categoryIdCell !== live.category_id) {
        if (categoryIdCell !== "") {
          const target = categoriesById.get(categoryIdCell);
          if (!target) {
            errors.push(
              `Subcategories row ${rowNumber} (${id}): unknown category "${categoryIdCell}"`,
            );
            return;
          }
          categoryEdit = target.id;
        } else {
          const createdCount =
            createdCategoryCounts.get(categoryDisplay) ?? 0;
          if (createdCount === 1) {
            categoryEdit = `new:${categoryDisplay}`;
          } else if (createdCount > 1) {
            errors.push(
              `Subcategories row ${rowNumber} (${id}): ambiguous category "${categoryDisplay}"`,
            );
            return;
          } else {
            errors.push(
              `Subcategories row ${rowNumber} (${id}): unknown category "${categoryDisplay || categoryIdCell}"`,
            );
            return;
          }
        }
        const sourceType = categoryTypeById.get(live.category_id);
        const targetType =
          categoryEdit.startsWith("new:")
            ? createdCategoryTypeByName.get(categoryDisplay)
            : categoryTypeById.get(categoryEdit);
        if (
          sourceType &&
          targetType &&
          sourceType !== targetType
        ) {
          errors.push(
            `Subcategories row ${rowNumber} (${id}): Cannot move subcategory between income and expense categories`,
          );
          return;
        }
      }
      const goalEdit =
        goalParsed.value !== live.monthly_goal ? goalParsed.value : undefined;
      const hasGoalEdit = goalParsed.value !== live.monthly_goal;
      const liveColor = live.color ?? "";
      const hasColorEdit = colorRaw !== liveColor;
      const colorEdit = hasColorEdit
        ? colorRaw === ""
          ? null
          : colorRaw
        : undefined;
      if (
        live.is_system &&
        (nameEdit !== undefined ||
          categoryEdit !== undefined ||
          hasGoalEdit)
      ) {
        errors.push(
          `Subcategories row ${rowNumber} (${id}): Cannot update system subcategories`,
        );
        return;
      }
      if (
        nameEdit !== undefined &&
        !claimName(
          "Subcategories",
          rowNumber,
          id,
          nameEdit,
          undefined,
          id,
        )
      ) {
        return;
      }
      if (
        nameEdit === undefined &&
        categoryEdit === undefined &&
        !hasGoalEdit &&
        !hasColorEdit
      ) {
        return;
      }
      const update: TaxonomyPending["subcategoryUpdates"][number] = {
        rowNumber,
        id,
      };
      if (nameEdit !== undefined) update.name = nameEdit;
      if (categoryEdit !== undefined) update.categoryId = categoryEdit;
      if (hasGoalEdit) update.monthlyGoal = goalEdit ?? null;
      if (hasColorEdit) update.color = colorEdit ?? null;
      pending.subcategoryUpdates.push(update);
    });
  }

  if (errors.length > 0) {
    for (const message of errors) console.error(message);
    console.error(`Applied 0 rows (${errors.length} invalid)`);
    throw new Error("Invalid taxonomy rows; applied zero rows");
  }

  return pending;
}

export function applyTaxonomyUpdates(
  pending: TaxonomyPending,
  dryRun: boolean,
  inputPath: string,
  fingerprint: string,
): { categories: number; subcategories: number } {
  const categoryCount =
    pending.categoryCreates.length +
    pending.categoryUpdates.length +
    pending.categoryDeletes.length;
  const subcategoryCount =
    pending.subcategoryCreates.length +
    pending.subcategoryUpdates.length +
    pending.subcategoryDeletes.length;

  if (dryRun) {
    for (const c of pending.categoryCreates) {
      console.log(`create category "${c.name}/${c.type}"`);
    }
    for (const c of pending.categoryUpdates) {
      if (c.name !== undefined) {
        console.log(`rename category ${c.id} to "${c.name}"`);
      } else {
        console.log(`update category ${c.id}`);
      }
    }
    for (const id of pending.categoryDeletes) {
      console.log(`delete category ${id}`);
    }
    for (const s of pending.subcategoryCreates) {
      console.log(`create subcategory "${s.categoryLabel} > ${s.name}"`);
    }
    for (const s of pending.subcategoryUpdates) {
      if (s.name !== undefined) {
        console.log(`rename subcategory ${s.id} to "${s.name}"`);
      } else {
        console.log(`update subcategory ${s.id}`);
      }
    }
    for (const id of pending.subcategoryDeletes) {
      console.log(`delete subcategory ${id}`);
    }
    console.log(
      `Dry run: ${categoryCount} categories, ${subcategoryCount} subcategories would update`,
    );
    return {
      categories: categoryCount,
      subcategories: subcategoryCount,
    };
  }

  const db = getDb();
  const createdCategoryIds = new Map<string, string>();

  const applyAll = db.transaction(() => {
    for (const c of pending.categoryCreates) {
      const created = createCategory({
        name: c.name,
        type: c.type as CategoryType,
        color: c.color,
      });
      createdCategoryIds.set(c.name, created.id);
    }
    for (const c of pending.categoryUpdates) {
      updateCategory(c.id, {
        ...(c.name !== undefined ? { name: c.name } : {}),
        ...(c.type !== undefined ? { type: c.type as CategoryType } : {}),
        ...(c.color !== undefined ? { color: c.color } : {}),
      });
    }
    for (const s of pending.subcategoryCreates) {
      let categoryId = s.categoryId;
      if (categoryId == null) {
        const resolved = createdCategoryIds.get(s.categoryLabel);
        if (!resolved) {
          throw new OperationalError(
            `Unknown category "${s.categoryLabel}"`,
            400,
          );
        }
        categoryId = resolved;
      }
      createSubcategory({
        name: s.name,
        category_id: categoryId,
        monthly_goal: s.monthlyGoal,
        color: s.color,
      });
    }
    for (const s of pending.subcategoryUpdates) {
      let categoryId = s.categoryId;
      if (categoryId !== undefined && categoryId.startsWith("new:")) {
        const label = categoryId.slice(4);
        const resolved = createdCategoryIds.get(label);
        if (!resolved) {
          throw new OperationalError(`Unknown category "${label}"`, 400);
        }
        categoryId = resolved;
      }
      updateSubcategory(s.id, {
        ...(s.name !== undefined ? { name: s.name } : {}),
        ...(categoryId !== undefined ? { category_id: categoryId } : {}),
        ...(s.monthlyGoal !== undefined
          ? { monthly_goal: s.monthlyGoal }
          : {}),
        ...(s.color !== undefined ? { color: s.color } : {}),
      });
    }
    for (const id of pending.subcategoryDeletes) {
      deleteSubcategory(id);
    }
    for (const id of pending.categoryDeletes) {
      deleteCategory(id);
    }
  });

  try {
    applyAll();
  } catch (error) {
    if (error instanceof OperationalError) {
      throw new Error(`apply failed: ${error.message}; applied zero rows`);
    }
    throw error;
  }

  console.log(
    `Updated ${categoryCount} categories, ${subcategoryCount} subcategories`,
  );

  const now = new Date();
  const resolvedInput = path.resolve(inputPath);
  const datePart = localDatePart(now);
  let archivePath = path.resolve(
    "data",
    "archive",
    `${datePart}-taxonomy-${fingerprint.slice(0, 8)}.fods`,
  );
  if (existsSync(archivePath)) {
    const ext = path.extname(archivePath);
    const base = archivePath.slice(0, -ext.length);
    archivePath = `${base}-${localTimePart(now)}${ext}`;
  }
  const logLine = `${JSON.stringify({
    timestamp: now.toISOString(),
    operation: "taxonomy.apply",
    input_path: resolvedInput,
    archive_path: archivePath,
    fingerprint,
    categories: categoryCount,
    subcategories: subcategoryCount,
    result: "applied",
  })}\n`;
  const logPath = path.resolve(
    "logs",
    "jsonl",
    `ods-${datePart}.jsonl`,
  );
  mkdirSync(path.dirname(logPath), { recursive: true });
  appendFileSync(logPath, logLine, "utf8");
  mkdirSync(path.dirname(archivePath), { recursive: true });
  renameSync(resolvedInput, archivePath);

  return {
    categories: categoryCount,
    subcategories: subcategoryCount,
  };
}

export function applyTaxonomyOds(
  inputPath: string,
  dryRun: boolean,
): { categories: number; subcategories: number } {
  const parsed = parseTaxonomyWorkbook(inputPath);
  const pending = validateTaxonomyRows(parsed);
  const fingerprint = parsed.meta.get("fingerprint") ?? "";
  return applyTaxonomyUpdates(pending, dryRun, inputPath, fingerprint);
}

async function main(): Promise<void> {
  const parsed = parseTaxonomyApplyArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(taxonomyApplyUsage());
    process.exitCode = 2;
    return;
  }
  try {
    applyTaxonomyOds(parsed.input, parsed.dryRun);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message !== "Invalid taxonomy rows; applied zero rows" &&
      !error.message.startsWith("apply failed:")
    ) {
      console.error(error.message);
    }
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
