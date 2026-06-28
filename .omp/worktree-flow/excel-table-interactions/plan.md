# Excel Table Interactions

## Context

The requested change is to make every table in the app support drag-resizable columns, with widths remembered in browser `localStorage` across reloads and future app sessions on the same browser. The Add Transactions and History pages also need Excel-like rectangular cell selection for editable transaction cells only, including drag selection, Shift range selection, Ctrl/Cmd additive selection, copy, cut, and paste. Invalid pasted values must be rejected per destination cell while valid cells still apply and existing validation feedback remains the source of truth.

## Approach

### 1. Add shared persistent column resizing

1. Create `src/features/table-layout/storage.ts` for browser-local table width persistence. Use `const STORAGE_KEY = "localfin.table-column-widths.v1"` and `const STORAGE_VERSION = 1`; store JSON as `{ version: 1, updatedAt: string, tables: Record<string, Record<string, number>> }`. Expose:
   - `export interface StoredTableColumnWidths { version: number; updatedAt: string; tables: Record<string, Record<string, number>>; }`
   - `export function defaultTableColumnWidths(): StoredTableColumnWidths`
   - `export function readAllTableColumnWidths(): StoredTableColumnWidths`
   - `export function readTableColumnWidths(tableId: string): Record<string, number>`
   - `export function writeTableColumnWidths(tableId: string, widths: Record<string, number>): void`
     Use a guarded storage accessor based on `(globalThis as { localStorage?: BrowserStorage }).localStorage ?? null`, matching the defensive localStorage style in `src/features/flagged-words/storage.ts` and the versioned `localfin.*.v1` shape in `src/features/display-settings/storage.ts`; invalid JSON, missing `tables`, non-finite widths, or widths below the hook minimum must fall back to defaults rather than throwing.
2. Create `src/features/table-layout/useResizableColumns.ts` with this exact public API, importing `CSSProperties` and `HTMLAttributes` as types from React:
   - `export interface ResizableColumnDef { id: string; defaultWidth: number; minWidth?: number; maxWidth?: number; }`
   - `export interface ResolvedResizableColumn extends ResizableColumnDef { width: number; minWidth: number; maxWidth: number; }`
   - `export function useResizableColumns(tableId: string, columnDefs: readonly ResizableColumnDef[]): { columns: ResolvedResizableColumn[]; totalWidth: number; getColStyle: (columnId: string) => CSSProperties; getHeaderStyle: (columnId: string) => CSSProperties; getResizeHandleProps: (columnId: string) => HTMLAttributes<HTMLSpanElement>; }`
     Use `MIN_COLUMN_WIDTH_PX = 48` and `MAX_COLUMN_WIDTH_PX = 640` defaults, clamp each persisted/default width, and persist the table's full `Record<columnId, width>` whenever a drag changes a width. Implement drag with pointer events: `onPointerDown` records start X/width, calls `event.preventDefault()` and `event.stopPropagation()`, sets pointer capture or document-level `pointermove`/`pointerup` listeners, updates width by `startWidth + (clientX - startX)`, and removes listeners on pointer up/cancel. The resize handle must be keyboard-neutral: no new app shortcuts, no sort toggles from dragging, and `role="separator"` with `aria-orientation="vertical"`.
3. In every converted table, render a `<colgroup>` from `columns`, set the table style to `{ minWidth: totalWidth, tableLayout: "fixed" }`, keep the existing `overflow-x-auto` wrapper, and add a right-edge resize handle inside each header cell. Add `relative` to resizable `<th>` elements and use a shared handle class equivalent to `absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40`.
4. Do not create a full table abstraction. Existing tables are hand-coded HTML tables with different row bodies, sort headers, grouped `<tbody>` sections, and nested expanded rows; the shared unit is only the storage/hook/resize handle behavior.

### 2. Apply column resizing to every visible table

Use local descriptor arrays beside each table's current header markup. The `tableId` values below are stable localStorage keys and must be used exactly.

1. `src/components/features/MultiTransactionTable.tsx` — `tableId: "transaction-input.manual-entry"`. Columns: `indicator` 32, `date` 112, `name` 176, `amount` 96, `kind` 96, `account` 128, `subcategory` 144, `tags` 176, `comment` 128, `remove` 32. Keep the existing editable-cell ref math (`idx * 8 + editableColumnIndex`) tied only to the 8 editable fields, not the indicator/remove columns.
2. `src/components/features/TransactionTable.tsx` — `tableId: "transaction-history.transactions"`. Replace the existing `sortableColumns` plus hardcoded static headers with one ordered descriptor list: `select` 48, `date` 128, `account` 160, `name` 220, `amount` 112, `balance` 112, `category` 160, `kind` 112, `subcategory` 180, `tags` 200, `actions` 96. Preserve sorting for `date`, `name`, `amount`, and `balance`; the resize handle's pointer events must not call `onSort`.
3. `src/components/features/RecentAccountTransactionsTable.tsx` — `tableId: "transaction-input.recent-activity"`. Columns: `account` 180, `date` 112, `latestTransaction` 240, `amount` 112, `currentBalance` 128.
4. `src/components/features/AccountSummary.tsx` — add two resize groups:
   - Outer `AccountSummaryTable`: `tableId: "dashboard.account-summary"` with `expander` 48, `account` 180, `type` 96, `starting` 128, `change` 128, `ending` 128.
   - Nested expanded transactions: `tableId: "dashboard.account-summary.transactions"` with `date` 112, `name` 220, `amount` 112, `balance` 112, `category` 180. Reuse the same nested widths for every expanded account row; do not key widths by account id.
5. `src/components/features/CategorySummary.tsx` — add two resize groups:
   - Outer `tableId: "dashboard.category-summary"` with `expander` 48, `category` 180, `type` 96, `total` 128, `goal` 128, `difference` 128.
   - Nested `tableId: "dashboard.category-summary.subcategories"` with `subcategory` 200, `total` 128, `goal` 128, `difference` 128.
6. `src/components/features/TagSummary.tsx` — add two resize groups:
   - Outer `tableId: "dashboard.tag-summary"` with `expander` 48, `tag` 180, `type` 112, `spend` 128, `income` 128, `net` 128, `count` 96.
   - Nested `tableId: "dashboard.tag-summary.categories"` with `category` 200, `spend` 128, `income` 128, `net` 128, `count` 96.
7. `src/components/features/TagManager.tsx` — `tableId: "settings.tags"` with `tag` 220, `type` 112, `color` 96, `actions` 96. Skip the nearby tag-create CSS grid; it is not a table.
8. `src/pages/SettingsPage.tsx` — `tableId: "settings.shortcuts"` with `command` 320, `scope` 140, `default` 140, `current` 180, `actions` 128. The table has grouped `<tbody>` sections; add one `<colgroup>` immediately after `<table>`, before `<thead>`, and keep `colSpan={5}` group rows unchanged.
9. `src/pages/SetupPage.tsx` — add resize wrappers/descriptors for all three section tables:
   - AccountsSection `tableId: "setup.accounts"` with `select` 48, `name` 180, `type` 112, `color` 96, `initialBalance` 140, `balance` 140, `actions` 112.
   - CategoriesSection `tableId: "setup.categories"` with `select` 48, `name` 200, `type` 112, `color` 96, `actions` 96.
   - SubcategoriesSection `tableId: "setup.subcategories"` with `select` 48, `name` 200, `category` 180, `monthlyGoal` 140, `color` 96, `actions` 96.
     Preserve the existing `SortHeader` component and shortcut behavior; add `overflow-x-auto` wrappers around these tables if absent so narrow screens scroll rather than squeezing columns below their minimum width.

### 3. Extract transaction-cell parsing and clipboard utilities

1. Create `src/lib/transactionCellParsing.ts` for pure parsing/reuse between Add Transactions and History. Move these helpers out of `MultiTransactionTable.tsx` into the new library, import them back into `MultiTransactionTable.tsx`, and do not leave duplicate parsing implementations:
   - `export type TransactionCellField = "date" | "name" | "amount" | "kind" | "account_id" | "subcategory_id" | "tag_ids" | "comment";`
   - `export type HistoryTransactionCellField = Exclude<TransactionCellField, "account_id">;`
   - `export const addTransactionCellFields: readonly TransactionCellField[] = ["date", "name", "amount", "kind", "account_id", "subcategory_id", "tag_ids", "comment"];`
   - `export const historyTransactionCellFields: readonly HistoryTransactionCellField[] = ["date", "name", "amount", "kind", "subcategory_id", "tag_ids", "comment"];`
   - `export function normaliseClipboardValue(value: string): string`
   - `export function resolveKind(value: string): TransactionKind | null`
   - `export function kindHasSubcategory(kind: TransactionKind): boolean`
   - `export function parsePastedAmount(value: string): number | null` — strip `$`, commas, and whitespace; return `null` unless the result is a finite number.
   - `export function parsePastedDate(value: string): { displayDate: string; isoDate: string } | null` — accept only real dates written as digits with `/` or `-` separators (`MM/DD/YY`, `MM/DD/YYYY`, or `YYYY-MM-DD`); reject alphabetic text; return Add Transactions display format `MM/DD/YYYY` plus History/API ISO format `YYYY-MM-DD`.
   - `export function resolveAccountId(value: string, accounts: { id: string; name: string }[]): string | null`
   - `export function resolveSubcategoryId(value: string, categories: Category[], subcategories: Subcategory[]): string | null`
   - `export function resolveTagIds(value: string, tags: Tag[]): string[]`
     Keep `formatAmountDisplay`, `getAccountType`, and `normalizeRowAmountDisplay` in `MultiTransactionTable.tsx`; Add Transactions must still normalize signs through `normalizeTransactionAmount`.
2. Create `src/features/spreadsheet-selection/selection.ts` for pure rectangular selection and TSV helpers:
   - `export interface CellCoord { row: number; col: number }`
   - `export interface CellRange { start: CellCoord; end: CellCoord }`
   - `export function normalizeRange(range: CellRange): { startRow: number; endRow: number; startCol: number; endCol: number }`
   - `export function isCellInRanges(cell: CellCoord, ranges: readonly CellRange[]): boolean`
   - `export function selectionBoundingRange(ranges: readonly CellRange[]): ReturnType<typeof normalizeRange> | null`
   - `export function parseClipboardMatrix(text: string): string[][]` — split CRLF/LF rows, preserve empty cells inside rows, drop only one final trailing blank row caused by a terminal newline.
   - `export function formatClipboardMatrix(matrix: readonly (readonly string[])[]): string` — join cells with tabs and rows with `\n`.
   - `export function rectangleFrom(anchor: CellCoord, focus: CellCoord): CellRange`
3. Add pure Node tests using the existing `tsx` runtime, without adding a frontend DOM test dependency:
   - `src/features/table-layout/storage.test.ts` covers invalid JSON fallback, per-table persistence, and finite-width sanitization using a tiny `globalThis.localStorage` stub.
   - `src/features/spreadsheet-selection/selection.test.ts` covers rectangular normalization, Shift range math, Ctrl/Cmd discontiguous range inclusion, TSV parse/format, and final-newline handling.
     Add a `test:frontend` script to `package.json`: `node --import tsx --test "src/**/*.test.ts"`. Do not change the existing `npm test` server script's behavior.

### 4. Add Excel-like selection and clipboard behavior to Add Transactions

1. In `src/components/features/MultiTransactionTable.tsx`, replace local `PasteField`/`pasteFields` with imports from `src/lib/transactionCellParsing.ts` (`TransactionCellField` and `addTransactionCellFields`) and update all references without changing the order: `date`, `name`, `amount`, `kind`, `account_id`, `subcategory_id`, `tag_ids`, `comment`.
2. Change `applyPastedValue` into a result-returning helper, for example `applyCellValue(row, field, value, options, mode): { row: TransactionRow; applied: boolean }`, where `mode` is `"paste"` or `"clear"`. Required behavior:
   - `date`: on paste, call `parsePastedDate`; apply `displayDate` only when non-null. Reject alphabetic text like `March rent`; do not silently strip it to an empty date. On cut/clear, set `date` to `""`.
   - `name`: on paste, apply non-empty text; on cut/clear, set `name` to `""`.
   - `amount`: on paste, call `parsePastedAmount`; apply only finite values, formatted with `formatAmountDisplay` and the current account type/kind. On cut/clear, set `amount` to `""`.
   - `kind`: on paste, apply only `income`, `expense`, `transfer`, or `adjustment`; if the new kind has no subcategory, clear `subcategory_id`. On cut/clear, leave `kind` unchanged because the select has no empty valid value.
   - `account_id`: on paste, apply only resolved account id and re-normalize amount for the account type; on cut/clear, set `account_id` to `""`.
   - `subcategory_id`: on paste, apply only a resolved subcategory and only when `kindHasSubcategory(row.kind)`; on cut/clear, set `subcategory_id` to `""`.
   - `tag_ids`: on paste, apply only when at least one tag resolves; on cut/clear, set `tag_ids` to `[]`.
   - `comment`: on paste, apply text; on cut/clear, set `comment` to `""`.
     This preserves the selected per-cell invalid rejection policy: invalid cells return `{ applied: false }` and leave that destination cell unchanged while later cells still process.
3. Add local selection state beside `rows`, `cellRefs`, `focusedRowId`, and `gridFocused`: `selectedRanges: CellRange[]`, `anchorCell: CellCoord | null`, `activeCell: CellCoord | null`, and `dragSelection: { anchor: CellCoord; additive: boolean } | null`.
4. Make each editable `<td>` a selectable cell wrapper with `data-row-index`, `data-col-index`, and selected styling. Use a single helper `getCellSelectionHandlers(rowIndex, colIndex)` to attach:
   - Plain click/pointer down: select exactly that cell, set anchor/active, and focus the existing input/select/button.
   - Drag across cells with the primary pointer: replace selection with the rectangle from drag anchor to current cell.
   - Shift+click: replace selection with the rectangle between `anchorCell` (or `activeCell` when no anchor exists) and the clicked cell.
   - Ctrl+click on Windows/Linux and Cmd+click on macOS: toggle that single cell without clearing other selected ranges; Ctrl/Cmd+drag adds the dragged rectangle to existing ranges.
     Inputs must still receive focus and remain editable; selection styling belongs to the `<td>` wrapper so text fields/selects are not replaced.
5. Add grid-level `onCopy`, `onCut`, `onPaste`, and `onKeyDown` handlers to the existing overflow wrapper. Behavior:
   - Copy: if at least one transaction cell is selected, `preventDefault()`, build a TSV matrix from the bounding rectangle of selected ranges, and write only selected cells' display values; unselected cells inside the bounding rectangle write as empty strings. Values: date display string, raw name, formatted amount string, kind, account display name, subcategory display label, comma-separated tag names, comment.
   - Cut: perform Copy, then apply `mode: "clear"` to selected cells. Cells that cannot be cleared validly, currently only `kind`, stay unchanged. Set `duplicatesChecked(false)` when any cell changes.
   - Paste: if selection exists, paste into the top-left selected cell; otherwise fall back to the focused cell's row/field, preserving current single-cell paste behavior. Parse TSV with `parseClipboardMatrix`; add rows as needed exactly as existing `handlePaste` does; process each cell through `applyCellValue(..., "paste")`; count skipped invalid cells but do not block valid cells.
   - Ctrl/Cmd+A while the grid wrapper is focused and no text input selection is active selects all editable cells in all current rows. Do not register this through the global shortcut system; handle it locally to avoid changing `src/features/shortcuts/commands.ts`.
6. Keep existing Add Transactions shortcuts from `src/features/shortcuts/commands.ts` intact: `Ctrl+Alt+ArrowRight` and `Ctrl+Alt+ArrowLeft` still move focus with `focusAdjacentCell`; `Ctrl+Enter` still saves; `Ctrl+Alt+Delete` still removes the focused row.

### 5. Add Excel-like selection and clipboard behavior to History

1. In `src/components/features/TransactionTable.tsx`, import `historyTransactionCellFields`, parsing helpers, and selection helpers. The selectable/editable History field order is exactly: `date`, `name`, `amount`, `kind`, `subcategory_id`, `tag_ids`, `comment`. Do not include `account`, `category`, `balance`, row checkbox, or actions; those are display-only or row controls in the current UI.
2. Add cell-level selection state inside `TransactionTable` using the same `CellCoord`/`CellRange` model as Add Transactions. Row indices are from the rendered `transactions` array; column indices are from `historyTransactionCellFields`.
3. Add selectable wrappers only around History's editable transaction fields:
   - Date cell maps to `date`.
   - Name cell maps to `name`; keep the existing comment display nested under the name, but add a separate small selectable comment region inside the same visual cell for `comment` so copy/cut/paste can target comments without adding a new visible table column.
   - Amount cell maps to `amount`.
   - Type cell maps to `kind`.
   - Subcategory cell maps to `subcategory_id` and must preserve the existing subcategory paste behavior for users who paste directly into that cell.
   - Tags cell maps to `tag_ids`.
     When a row is in inline edit mode, the existing inputs/selects/`TagPicker` remain the editors; when not editing, clicking a selectable cell selects it rather than entering row edit mode.
4. Change `TransactionTableProps.onEdit` from `(id, updates) => Promise<void>` to `(id, updates, options?: { silent?: boolean }) => Promise<boolean>`. Update its only callsite in `src/pages/TransactionHistoryPage.tsx` (`handleEdit` passed to `<TransactionTable />`) so it returns `true` on successful `updateTransaction.mutateAsync`, returns `false` on failure, and suppresses per-row success/error toasts when `options?.silent` is true. Existing single-row save should keep the current success/error toasts; `saveEdit` should only close edit mode when `onEdit` returns `true`.
5. Add `parseHistoryCellValue(field, value, transaction): { updates: UpdateTransactionData; applied: boolean }` inside `TransactionTable.tsx`. Required behavior before calling `onEdit`:
   - `date`: use `parsePastedDate(value)?.isoDate`; reject text/invalid dates.
   - `name`: require non-empty trimmed text to satisfy backend `nonEmptyString`.
   - `amount`: use `parsePastedAmount`; reject non-finite/empty values.
   - `kind`: use `resolveKind`; when changing to `transfer` or `adjustment`, include `subcategory_id: null`.
   - `subcategory_id`: resolve with `resolveSubcategoryId`; reject unresolved values; if current or pasted kind has no subcategory, reject rather than sending an incompatible subcategory.
   - `tag_ids`: resolve comma-separated tag names/ids; reject when no tag resolves; reject more than 50 resolved ids before mutation so no partial tag overrun is sent to the backend.
   - `comment`: send trimmed text or `null` for empty.
     Cut/clear uses the same validation: optional fields (`subcategory_id`, `tag_ids`, `comment`) clear to `null`/`[]`/`null`; required fields (`date`, `name`, `amount`, `kind`) stay unchanged because clearing them would violate the update schema.
6. Add History wrapper `onCopy`, `onCut`, `onPaste`, and local `onKeyDown` behavior matching Add Transactions. For paste/cut that touches multiple cells in the same row, aggregate valid field updates into one `UpdateTransactionData` per transaction id, then call `await onEdit(id, updates, { silent: true })` once per affected row. Continue processing other rows if one row update fails. After completion, show one toast from `TransactionTable`: success summary for updated cell/row count and warning/error summary for skipped invalid cells or failed rows. Do not modify `selectedIds`; row checkbox/bulk selection remains independent from spreadsheet cell selection.
7. Preserve existing History shortcuts from `src/features/shortcuts/commands.ts`: row focus (`ArrowUp`, `ArrowDown`, `Home`, `End`), row toggle (`Space`), edit (`Enter`), delete (`Delete`), sort (`Alt+1` through `Alt+4`), and bulk actions. Local Ctrl/Cmd+A applies only when focus is on a selectable History cell and selects all visible editable History cells; it must not trigger row selection.

### 6. Visual and accessibility details

1. Selected cells on Add Transactions and History should use a visible Excel-like style on the `<td>`/cell wrapper: `bg-ring/15 outline outline-1 outline-ring` for selected cells and a slightly stronger outline for `activeCell`. Do not rely on native text selection for multi-cell highlighting.
2. While dragging a selection, set `document.body.style.userSelect = "none"` and restore the previous value on pointer up/cancel so text does not accidentally highlight.
3. Preserve native text editing inside focused inputs: if the user drags inside an input text value rather than from the cell edge/wrapper, the input may keep native text selection. Cell-range drag starts from the cell wrapper pointer handler; do not attach range-drag handlers to inner text inputs' text-selection events.
4. For copied display values, use existing display helpers where present: `formatCategoryLabel`/`formatSubcategoryLabel` for subcategories, tag names from `tags`, account names from `accounts`, and `formatAmountDisplay`/`formatCurrency` only for display/copy. Paste must use parsers and existing ids, not display strings as ids unless the resolver explicitly supports names.

## Critical files & anchors

- `src/features/table-layout/storage.ts` and `src/features/table-layout/useResizableColumns.ts` — new shared persistence/hook layer for every resizable table; copy the guarded localStorage pattern from `src/features/display-settings/storage.ts`.
- `src/components/features/MultiTransactionTable.tsx` — Add Transactions manual-entry grid; current editable field order and ref math are around `TransactionRow`, `PasteField`, `pasteFields`, `applyPastedValue`, `handlePaste`, and the table body.
- `src/components/features/TransactionTable.tsx` — History table; current row selection, inline edit state, sortable headers, and subcategory paste live here.
- `src/pages/SetupPage.tsx` — contains three page-local tables (`AccountsSection`, `CategoriesSection`, `SubcategoriesSection`) that are not shared feature components and need explicit resize integration.
- `src/pages/SettingsPage.tsx` plus `src/components/features/TagManager.tsx`/summary-table components — remaining visible hand-coded tables; use the descriptor list in the Approach to avoid missing grouped or nested tables.

## Verification

1. Run static/project checks from `C:/Users/joesa/Code/localfin-ai`:
   - `npm run typecheck` — must pass.
   - `npm run lint` — must pass without disabling rules inline.
   - `npm run build` — must pass.
   - `npm test` — must keep passing existing server tests.
   - `npm run test:frontend` — must pass the new pure helper tests added for storage and spreadsheet selection.
2. Browser smoke test for column resizing:
   - Start the app with `npm run dev` from `C:/Users/joesa/Code/localfin-ai`. Use the existing `.env` with `OPENROUTER_API_KEY`; no new backend setting is needed for this feature.
   - Visit `http://localhost:5173/transactions/input`, drag the right edge of the Add Transactions `Name` column wider, reload the page, and verify the `Name` column keeps the new width.
   - Visit `http://localhost:5173/transactions/history`, drag the History `Amount` column narrower, navigate to `/settings`, then back to `/transactions/history`, and verify the width persists.
   - Visit `/`, `/setup`, and `/settings`; verify every visible table header has a draggable right edge and horizontal scrolling appears instead of squeezed unreadable columns when columns are widened.
   - Inspect `window.localStorage.getItem("localfin.table-column-widths.v1")` in DevTools and verify it contains separate table ids such as `transaction-input.manual-entry`, `transaction-history.transactions`, and `settings.shortcuts`.
3. Browser smoke test for Add Transactions selection/clipboard:
   - On `/transactions/input`, click the first editable date cell, Shift+click the second row amount cell, and verify the rectangular range from row 1/date through row 2/amount is highlighted.
   - Ctrl+click or Cmd+click a non-adjacent comment cell and verify it remains selected along with the prior range.
   - Drag from row 1/name to row 3/comment and verify all crossed editable cells highlight while row remove buttons and duplicate indicator cells do not become selectable.
   - Copy a selected rectangle and paste into a plain text editor; verify cells are tab-delimited and rows are newline-delimited.
   - Paste TSV into the first row with at least one invalid date text value such as `March rent` in a date column and valid name/amount values in adjacent cells. Expected: valid name/amount cells update, the invalid date destination stays unchanged, and no pasted text appears in the date field.
   - Cut a selection containing `date`, `name`, `amount`, `kind`, `account`, `subcategory`, `tags`, and `comment`. Expected: clearable fields clear, `kind` stays unchanged, and the clipboard contains the pre-cut values.
   - Press Ctrl/Cmd+A while the grid is focused and verify all editable Add Transactions cells select; existing `Ctrl+Enter` save and `Ctrl+Alt+ArrowRight/Left` cell navigation still work.
4. Browser smoke test for History selection/clipboard:
   - On `/transactions/history`, click an editable History cell, Shift+click another editable cell several rows away, and verify only editable transaction cells in the rectangle highlight; checkbox, account, category, balance, and actions cells do not highlight.
   - Ctrl/Cmd+click multiple non-adjacent editable cells and verify row checkbox selection count does not change.
   - Copy selected History cells and verify TSV display values are correct.
   - Paste a TSV range containing a valid ISO date (`2026-01-15`), a valid amount (`$12.34`), an invalid date text (`not a date`), and an invalid kind (`maybe`). Expected: valid cells update through the existing transaction update API, invalid date/kind cells remain unchanged, and a single summary toast reports skipped invalid cells.
   - Cut optional History fields (`subcategory`, `tags`, `comment`) and verify they clear; cut required fields (`date`, `name`, `amount`, `kind`) and verify they remain unchanged.
   - Verify existing History row behavior still works: checkboxes select rows, `Space` toggles focused row, `Enter` opens inline edit, `Ctrl+Enter` saves inline edit, `Alt+1` through `Alt+4` sort, and the old subcategory paste path still applies a pasted subcategory.
5. Regression checks tied to validation:
   - Add Transactions paste must still append rows when pasted TSV has more rows than currently exist.
   - History paste must aggregate multiple valid cells for the same transaction into one update call and must not clear row/bulk selection state.
   - Backend validation remains authoritative: if a History mutation fails, the failed row is reported and other valid rows continue processing.

## Assumptions & contingencies

- Persistence is browser-local `localStorage`, not SQLite or a server setting, because the user chose browser localStorage. If `localStorage` is unavailable or contains invalid JSON, the app falls back to default widths and keeps working without persistence.
- Selection/cut/copy/paste is limited to editable transaction cells on Add Transactions and History. Other tables get column resizing only; row checkboxes, action buttons, computed balances, account/category display cells, and dashboard summary cells are not spreadsheet-editable.
- Per-cell invalid paste rejection is required. Valid cells in the same paste operation still apply; invalid destination cells stay unchanged. For History, frontend parsing filters obvious invalid values before calling the update API, and backend zod validation remains the final guard.
- Ctrl/Cmd+A is implemented locally for transaction-cell grids only. Existing app shortcut definitions in `src/features/shortcuts/commands.ts` are left unchanged unless a direct conflict is found during implementation; if a conflict appears, keep existing app shortcuts and scope Ctrl/Cmd+A to focused selectable cells only.
- There is no existing frontend DOM test harness. The plan adds pure Node tests for shared selection/storage logic and requires browser QA for pointer drag, real clipboard, focus, and table layout behavior.
