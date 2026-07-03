# Spreadsheet Range Actions Plan

## Context

Add four Excel-like grid behaviors to the Add Transactions and Transaction History tables: filling the currently selected cells with one pasted scalar value, clearing selected cells with Delete/Backspace, showing a copied-range visual indicator, and arrow-key spreadsheet navigation. User choices are settled: scalar fill applies to every selected cell, including Ctrl/Cmd-added discontiguous cells; arrow navigation should be Excel-like rather than native-input-conservative; include Escape to clear selection and make copied-range highlighting fade after paste/Escape/focus change. Current code already has selection state, drag selection, TSV copy/cut/paste, and field parsers in `src/components/features/MultiTransactionTable.tsx`, `src/components/features/TransactionTable.tsx`, `src/features/spreadsheet-selection/selection.ts`, and `src/lib/transactionCellParsing.ts`; this change extends those paths rather than replacing them.

## Approach

### Add shared range helpers first

1. Update `src/features/spreadsheet-selection/selection.ts` with shared, pure helpers used by both grids:
   - Add `export type SpreadsheetArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";`.
   - Add `export function expandRangesToCells(ranges: readonly CellRange[], rowCount: number, colCount: number): CellCoord[]`.
     - Return cells in stable row-major order.
     - Clamp to `0 <= row < rowCount` and `0 <= col < colCount`.
     - Return `[]` when `rowCount <= 0`, `colCount <= 0`, or `ranges.length === 0`.
     - Use existing `isCellInRanges`; do not duplicate range normalization rules.
   - Add `export function topLeftCell(cells: readonly CellCoord[]): CellCoord | null`.
     - Return `null` for an empty list.
     - Otherwise return the lowest row, then lowest col, matching the current inline reductions in both tables.
   - Add `export function isSingleCellMatrix(matrix: readonly (readonly string[])[]): boolean`.
     - Return `true` only when `matrix.length === 1` and `(matrix[0]?.length ?? 0) === 1`.
     - This preserves existing structured TSV behavior; only a 1x1 clipboard payload triggers scalar fill.
   - Add `export function moveCellWithinBounds(cell: CellCoord, key: SpreadsheetArrowKey, rowCount: number, colCount: number): CellCoord | null`.
     - Return `null` if the grid has no rows or columns.
     - Clamp at table edges; do not wrap to another row/column.
     - `ArrowLeft` decrements col, `ArrowRight` increments col, `ArrowUp` decrements row, `ArrowDown` increments row.
2. Update `src/features/spreadsheet-selection/selection.test.ts` in the existing `node:test` style.
   - Assert `expandRangesToCells` returns row-major cells for a 2x2 rectangle and preserves discontiguous selected cells without including holes.
   - Assert `topLeftCell([{ row: 2, col: 3 }, { row: 1, col: 8 }, { row: 1, col: 2 }])` returns `{ row: 1, col: 2 }`.
   - Assert `isSingleCellMatrix([["Coffee"]]) === true`, `isSingleCellMatrix([["Coffee", "Tea"]]) === false`, and `isSingleCellMatrix([["Coffee"], ["Tea"]]) === false`.
   - Assert `moveCellWithinBounds({ row: 0, col: 0 }, "ArrowLeft", 2, 2)` and `"ArrowUp"` both clamp to `{ row: 0, col: 0 }`; assert right/down move to `{ row: 0, col: 1 }` and `{ row: 1, col: 0 }`; assert empty dimensions return `null`.

### Add shared editable-target guards

1. Create `src/features/spreadsheet-selection/domTargets.ts` because both table components currently hand-roll related DOM guards.
2. Export exactly:
   - `export function isNativeEditableTarget(target: EventTarget | null): boolean`
     - Return `true` for `HTMLInputElement`, `HTMLTextAreaElement`, `HTMLSelectElement`, or an `HTMLElement` with `isContentEditable === true`.
     - Return `false` when DOM constructors are unavailable; this keeps Node tests safe.
   - `export function hasSelectedInputText(target: EventTarget | null): boolean`
     - Return `true` only for `HTMLInputElement` or `HTMLTextAreaElement` where both `selectionStart` and `selectionEnd` are numbers and differ.
3. Replace repeated interactive-target checks in `src/components/features/TransactionTable.tsx` copy/cut/paste/key handlers with these helpers without changing History behavior.
4. Replace Add Transactions copy/cut/paste/key guard logic in `src/components/features/MultiTransactionTable.tsx` with these helpers so selects and contenteditable targets get the same protection History already has.

### Add range clearing and scalar fill to Add Transactions

1. In `src/components/features/MultiTransactionTable.tsx`, replace the local `expandSelectedCells` implementation with a wrapper around `expandRangesToCells(selectedRanges, rows.length, addTransactionCellFields.length)`. Keep the symbol name `expandSelectedCells` so existing callsites stay simple.
2. Extract the clearing loop from `handleGridCut` into a reusable component callback:
   - `const clearSelectedManualCells = useCallback((selectedCells: CellCoord[], label: string) => { ... }, [...])`
   - Reuse `applyCellValue(..., "clear")`; do not duplicate per-field clear rules.
   - Preserve current Add draft clear semantics: `kind` is not cleared; date/name/amount/account/subcategory/comment clear to `""`; tags clear to `[]`; clearing an AI-suggested subcategory changes `categorizationSource` to `"manual"`; only changed cells count.
   - Use `executeDraftSnapshotAction(label, before, after)` with exact labels:
     - `"Cut transaction cells"` when called from `handleGridCut`.
     - `"Clear transaction cells"` when called from Delete/Backspace.
   - Set `duplicatesChecked: false` whenever any selected draft cell changes, as current cut does.
   - Return `true` when at least one cell changed; otherwise return `false`.
3. Update `handleGridCut` to write the current selection to the clipboard, then call `clearSelectedManualCells(expandSelectedCells(), "Cut transaction cells")`.
4. Add a new callback for scalar fill:
   - `const fillSelectedManualCells = useCallback((value: string, selectedCells: CellCoord[]) => { ... }, [...])`
   - For each selected cell in row-major order, get `field = addTransactionCellFields[cell.col]` and the cloned draft row at `cell.row`; skip missing rows/fields.
   - Apply the same `value` with `applyCellValue(row, field, value, accounts, categories, subcategories, tags, "paste")`.
   - Accumulate multiple selected cells in the same row against the latest row draft so filling date+name in one row works deterministically.
   - Count invalid/non-applied paste cells in `skipped`, matching `applyClipboardMatrix`.
   - Changed rows get `isDuplicate: false`.
   - Use `executeDraftSnapshotAction("Fill transaction cells", before, after, onInitialApply)` for successful fills.
   - Emit `toast.warning(\`Skipped ${skipped} invalid pasted cell(s).\`)` when `skipped > 0`, using the same text as `applyClipboardMatrix`.
   - If nothing changes and `skipped > 0`, warn and return; if nothing changes and `skipped === 0`, return silently.
5. Update `handleGridPaste`:
   - Parse once: `const matrix = parseClipboardMatrix(text)`.
   - Get `const selectedCells = expandSelectedCells()`.
   - If `isSingleCellMatrix(matrix)` and `selectedCells.length > 1`, `event.preventDefault()`, call `fillSelectedManualCells(matrix[0]?.[0] ?? "", selectedCells)`, then clear copied-range state as described below.
   - Otherwise preserve current matrix paste behavior: find `topLeftCell(selectedCells)`, call `applyClipboardMatrix(matrix, startCell.row, startCell.col, "paste")`, and do not constrain structured paste to selected cells.
   - Keep native scalar paste into a text input with selected text unchanged by returning early when `hasSelectedInputText(event.target)` is true.
   - Keep native scalar paste into a single focused input unchanged when clipboard text has no tab/newline and there is exactly one selected cell; this preserves current direct-edit behavior.

### Add range clearing and scalar fill to Transaction History

1. In `src/components/features/TransactionTable.tsx`, replace the local `expandSelectedCells` implementation with `expandRangesToCells(selectedRanges, transactions.length, historyTransactionCellFields.length)`.
2. Keep `clearSelectedHistoryCells` as the single clear implementation and call it from both cut and Delete/Backspace.
   - Preserve current persisted clear semantics in `parseHistoryCellValue(..., "clear")`: only `subcategory_id`, `tag_ids`, and `comment` are clearable; date/name/amount/kind remain non-clearable because the existing backend update shape expects valid required values.
   - Use existing label `"Clear transaction cells"` and success toast `Cleared ${updatedCells} cell(s) across ${updatedRows} row(s).`.
3. Add a new persisted scalar-fill callback:
   - `const fillSelectedHistoryCells = useCallback(async (value: string, selectedCells: CellCoord[]) => { ... }, [...])`
   - Build `updatesById` exactly like `applyHistoryClipboardMatrix`, keyed by transaction id.
   - For each selected cell, resolve `transaction = transactions[cell.row]` and `field = historyTransactionCellFields[cell.col]`; skip missing rows/fields.
   - Use `parseHistoryCellValue(field, value, transaction, "paste", draftKind)` where `draftKind = existing.updates.kind ?? transaction.kind` so a selected row with both kind and subcategory cells uses the newly filled kind when parsing subcategory.
   - Increment `skipped` for each non-applied cell.
   - Call `onEditMany(changes, { silent: true, label: "Fill transaction cells" })`.
   - On success with updates, call `successToast(\`Filled ${updatedCells} cell(s) across ${updatedRows} row(s).\`)`.
   - If `skipped > 0` or `ok === false`, call `toast.warning(\`Skipped ${skipped} invalid cell(s); ${ok ? 0 : 1} row update(s) failed.\`)`, matching the existing History warning format.
4. Update `handleHistoryPaste`:
   - Parse once.
   - If `isSingleCellMatrix(matrix)` and more than one selected cell exists, prevent default and call `void fillSelectedHistoryCells(matrix[0]?.[0] ?? "", selectedCells)`.
   - Otherwise preserve current top-left matrix paste through `applyHistoryClipboardMatrix(matrix, startCell.row, startCell.col, "paste")`.
   - Preserve the existing `isNativeEditableTarget(event.target)` early return for row edit controls and contenteditable targets.
5. Do not use `bulkUpdateTransactions` for scalar fill. Parent `handleEditMany` in `src/pages/TransactionHistoryPage.tsx` already records undo snapshots and accepts heterogeneous `UpdateTransactionData`; `BulkTransactionUpdateData` cannot represent date/name/amount/comment or per-row field values.

### Add copied-range indicator and lifecycle

1. In both table components, add copied-range state near the current selection state:
   - `const [copiedRanges, setCopiedRanges] = useState<CellRange[]>([]);`
   - `const copiedRangeTimeoutRef = useRef<number | null>(null);`
2. Add local helpers in each component:
   - `clearCopiedRanges()` checks `if (copiedRangeTimeoutRef.current !== null && typeof window !== "undefined") window.clearTimeout(copiedRangeTimeoutRef.current);`, sets the ref to `null`, and sets `copiedRanges` to `[]`.
   - `markCopiedRanges()` copies `selectedRanges` into `copiedRanges`, clears any previous timeout through `clearCopiedRanges()`, then if `typeof window !== "undefined"` stores `window.setTimeout(clearCopiedRanges, 1200)` in `copiedRangeTimeoutRef.current`.
   - If `window` is unavailable, copied ranges still set and clear through paste/Escape/blur/unmount; no timer is scheduled.
3. Call `markCopiedRanges()` only after successful copy in `handleGridCopy` / `handleHistoryCopy`.
   - Do not mark copied ranges for cut; cut clears source cells immediately and a copied-source indicator would highlight emptied cells.
4. Clear copied ranges in both components:
   - After any handled paste path, including scalar fill and structured matrix paste.
   - On Escape.
   - When focus truly leaves the grid/table container in existing `onBlur` handlers.
   - In a `useEffect` cleanup on component unmount to clear the timeout.
5. Extend `getCellClassName` and `getHistoryCellClassName`:
   - Compute `const copied = isCellInRanges(cell, copiedRanges)`.
   - Append copied classes after selected/active classes so the copied indicator is visible: `copied && "bg-primary/10 outline-dashed outline-2 outline-primary"`.
   - Keep existing selected and active classes unchanged: selected remains `bg-ring/15 outline outline-1 outline-ring`; active remains `outline-2`.

### Add Delete/Backspace, Escape, and Arrow navigation

1. Add local helpers in both table components:
   - `const isSpreadsheetArrowKey = (key: string): key is SpreadsheetArrowKey => key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";`
   - `getCurrentNavigationCell()` returns `activeCell ?? topLeftCell(expandSelectedCells()) ?? { row: 0, col: 0 }`, then clamps through `moveCellWithinBounds` by calling it with the current key; if the table has no rows, return `null`.
2. Add focus helpers:
   - Add Transactions already has `focusEditableCell(rowIndex, colIndex)` using `cellRefs`.
   - Transaction History should add `focusHistoryGridCell(rowIndex, colIndex)` that queries within `tableContainerRef.current` for `[data-row-index="${rowIndex}"][data-col-index="${colIndex}"]` and focuses the resulting `HTMLElement`; do not add dozens of per-cell refs.
3. Add edit-mode state to support Excel-like arrows without permanently stealing native text-edit keys:
   - In Add Transactions, add `const [editingCell, setEditingCell] = useState<CellCoord | null>(null);`.
   - In Transaction History, use existing `editingId !== null` as row edit mode; do not add a separate history edit state.
   - In Add Transactions, double-clicking a data cell or pressing plain `Enter`/`F2` while a cell is active sets `editingCell` to that cell and focuses its control. For `HTMLInputElement`/`HTMLTextAreaElement`, place the caret at the end with `setSelectionRange(value.length, value.length)` inside `requestAnimationFrame`.
   - While `editingCell` matches the active Add Transactions cell and `isNativeEditableTarget(event.target)` is true, let Arrow/Delete/Backspace be native text/control behavior. Escape exits edit mode first; if no edit mode is active, Escape clears selection and copied range.
   - When selection changes by pointer, Ctrl/Cmd, Shift, Arrow navigation, paste, cut, Delete/Backspace, or blur, set `editingCell(null)`.
   - Do not set inputs `readOnly`; preserve current direct typing behavior. The new edit-mode state controls whether Arrow/Delete/Backspace are intercepted, not whether printable characters can edit.
4. Update Add Transactions `handleGridContainerKeyDown` order:
   - Change `handleGridKeyDown` to return `boolean`, where `true` means it handled and prevented/allowed the key intentionally.
   - In `handleGridContainerKeyDown`, call `if (handleGridKeyDown(event)) return;` before `handleEnterSave`.
5. Update Add Transactions `handleGridKeyDown`:
   - If `event.key` is plain `Enter` and a spreadsheet cell is active, enter Add cell edit mode and return `true`; keep `Ctrl+Enter` Save All behavior unchanged because Ctrl-modified Enter must return `false` and fall through to `handleEnterSave`.
   - If `event.key === "F2"`, enter Add cell edit mode and return `true`.
   - Return `false` for Ctrl/Cmd/Alt-modified arrows so existing `Ctrl+Alt+ArrowLeft/Right` shortcut commands keep working.
   - For `Delete` or `Backspace`: if not in Add cell edit mode, prevent default, stop propagation, clear copied ranges, call `clearSelectedManualCells(expandSelectedCells(), "Clear transaction cells")`, and return `true`.
   - For `Escape`: prevent default, stop propagation, set `selectedRanges([])`, `setAnchorCell(null)`, `setActiveCell(null)`, `setEditingCell(null)`, clear copied ranges, and return `true`.
   - For plain arrow keys: compute `nextCell = moveCellWithinBounds(currentCell, event.key, rows.length, addTransactionCellFields.length)`. If `event.shiftKey`, set `selectedRanges([rectangleFrom(anchorCell ?? currentCell, nextCell)])`, keep the original anchor, set active to `nextCell`; otherwise select only `nextCell` and set anchor to `nextCell`. Focus the destination control with `focusEditableCell(nextCell.row, nextCell.col)`, clear copied ranges, prevent default, stop propagation, and return `true`.
   - Preserve existing Ctrl/Cmd+A select-all behavior; also require the active element to be inside `gridContainerRef.current` so global Ctrl/Cmd+A elsewhere cannot select the grid. Return `true` after handling Ctrl/Cmd+A.
   - For all unhandled keys, return `false` so existing Save All and shortcut behavior can continue.
6. Update Transaction History `handleHistoryKeyDown`:
   - If `editingId !== null`, let existing row-edit controls and `transactionHistory.cancelEdit` / `saveEdit` shortcuts handle keys.
   - Return early for `isNativeEditableTarget(event.target)`.
   - For `Delete` or `Backspace`: prevent default and stop propagation, clear copied ranges, call `void clearSelectedHistoryCells(expandSelectedCells())`, and return. This prevents the existing focused-row delete shortcut from opening the row delete modal when a cell range is active.
   - For `Escape`: prevent default and stop propagation, clear `selectedRanges`, `anchorCell`, `activeCell`, and copied ranges; do not cancel row edit because this branch is skipped while `editingId !== null`.
   - For plain arrow keys: use `moveCellWithinBounds(currentCell, event.key, transactions.length, historyTransactionCellFields.length)`, update selection exactly like Add Transactions, focus the destination with `focusHistoryGridCell`, clear copied ranges, prevent default, stop propagation.
   - Preserve existing Ctrl/Cmd+A select-all behavior and its requirement that the active element be inside a selectable data cell.

### Update user-facing helper text

1. Update the Add Transactions tip below the manual grid in `src/components/features/MultiTransactionTable.tsx`.
   - Replace the current text with: `Tip: Paste tab-delimited data to populate rows, paste one value over a selected range to fill it, use Delete/Backspace to clear selected cells, and use Arrow keys to move between cells.`
2. Do not add a new tooltip to Transaction History. The existing table is already dense; the feature is keyboard behavior and should be verified by tests/manual QA rather than extra persistent copy.

### Add tests

1. Extend `src/features/spreadsheet-selection/selection.test.ts` for all new pure helpers from the first step.
2. Create `src/features/spreadsheet-selection/domTargets.test.ts` with no-DOM safety coverage only.
   - Temporarily delete any existing `globalThis.HTMLElement`, `globalThis.HTMLInputElement`, `globalThis.HTMLTextAreaElement`, and `globalThis.HTMLSelectElement` properties in `beforeEach`, restore them in `afterEach`, and assert `isNativeEditableTarget({} as EventTarget) === false` and `hasSelectedInputText({} as EventTarget) === false`.
   - Do not add jsdom, Testing Library, Vitest, Jest, or fake full DOM constructors for this ticket.
3. Do not create component DOM tests. Current repo test infrastructure is pure `node:test`; use helper tests plus the manual browser QA below for key/focus/class behavior.

## Critical files & anchors

- `src/components/features/MultiTransactionTable.tsx` — Add Transactions draft grid. Use `applyCellValue` around lines 198-334, selection/focus/class handlers around lines 694-820, clipboard/key handlers around lines 853-1125, and grid render wiring around lines 1594-1937.
- `src/components/features/TransactionTable.tsx` — Transaction History persisted grid. Use selection/class handlers around lines 557-670, persisted parsing/apply/clear around lines 698-946, clipboard/key handlers around lines 948-1053, and rendered data-cell `data-row-index`/`data-col-index` anchors around lines 1210-1438.
- `src/pages/TransactionHistoryPage.tsx` — Parent persisted update path. `handleEditMany` around lines 234-295 is the correct undo/redo-backed API for History scalar fill and clear.
- `src/features/spreadsheet-selection/selection.ts` — Existing shared coordinate/TSV helper module. Add pure range expansion, top-left, single-cell matrix, and arrow movement here.
- `src/features/spreadsheet-selection/selection.test.ts` — Existing Node test file for shared spreadsheet helpers; extend it for new helper behavior.

## Verification

1. Run targeted helper tests after adding shared helpers:
   - Working directory: `C:/Users/joesa/Code/localfin-ai`
   - Command: `node --import tsx --test src/features/spreadsheet-selection/selection.test.ts`
   - Expected: all existing tests plus new helper tests pass.
2. If `src/features/spreadsheet-selection/domTargets.test.ts` is created, run:
   - Command: `node --import tsx --test src/features/spreadsheet-selection/domTargets.test.ts`
   - Expected: editable-target helpers return false without DOM constructors and true/false correctly for fake input/textarea/select/contenteditable objects if fakes are implemented.
3. Run the frontend suite:
   - Command: `npm run test:frontend`
   - Expected: all frontend Node tests pass.
4. Run TypeScript:
   - Command: `npm run typecheck`
   - Expected: no TypeScript errors.
5. Run lint:
   - Command: `npm run lint`
   - Expected: no ESLint errors.
6. Manual Add Transactions QA:
   - Start app with `npm run dev` from `C:/Users/joesa/Code/localfin-ai`; use the repo's normal `.env` with `OPENROUTER_API_KEY` if the server requires it.
   - Open `http://localhost:5173/transactions/input`.
   - Click `Add Row` once so at least two draft rows exist.
   - Select the first row Name cell, hold Shift, press ArrowDown. Expected: two Name cells are selected.
   - Copy the text `Coffee` from any external text field and paste. Expected: both selected Name fields become `Coffee`, one undo action labeled `Fill transaction cells` is created, and any copied-range outline clears after paste.
   - With the same two Name cells selected, press Backspace. Expected: both Name fields clear; Type/kind cells are unaffected if included in a mixed selection.
   - Select the first row Date cell and press ArrowRight. Expected: active outline moves to Name. Press Shift+ArrowDown. Expected: range extends from the Date/Name anchor as defined by the active cell and selected cells show the existing selected styling.
   - Select a filled rectangular range and press Ctrl/Cmd+C. Expected: copied cells show dashed primary outline, then it disappears after about 1200 ms or immediately after Escape/paste/focus leaving the grid.
7. Manual Transaction History QA:
   - Open `http://localhost:5173/transactions/history` with at least two visible transactions; if none exist, create two draft transactions from `/transactions/input` first.
   - Select two visible comment cells, paste scalar text `Reviewed`. Expected: both comments update through persisted row updates and success toast says `Filled 2 cell(s) across 2 row(s).`
   - Press Delete with those comment cells selected. Expected: comments clear through `onEditMany`; the row delete confirmation modal does not open.
   - Press ArrowRight/ArrowLeft/ArrowUp/ArrowDown with a history data cell focused. Expected: active cell moves within the visual sorted table and clamps at edges.
   - Enter row edit mode on one transaction, focus an edit input, press Escape. Expected: existing edit cancel behavior still works; spreadsheet Escape clear does not run while `editingId !== null`.

## Assumptions & contingencies

- Scalar fill applies to the actual selected cells, including Ctrl/Cmd-added discontiguous cells; it does not fill unselected holes inside the bounding rectangle.
- Structured TSV paste keeps existing top-left matrix behavior and is not constrained to the selected shape.
- Add Transactions direct printable typing remains allowed; the new Add `editingCell` state only decides whether Arrow/Delete/Backspace are intercepted or native, preventing a broad read-only-cell rewrite.
- Transaction History required fields remain non-clearable by Delete/Backspace because current clear mode only clears nullable/non-required persisted fields. If backend validation later proves date/name/amount can accept a safe blank/default through `UpdateTransactionData`, update `parseHistoryCellValue(..., "clear")` deliberately and add tests for those exact payloads before changing this behavior.
- Copied-range indicator marks copy only, not cut, because cut immediately mutates/clears the source cells.
