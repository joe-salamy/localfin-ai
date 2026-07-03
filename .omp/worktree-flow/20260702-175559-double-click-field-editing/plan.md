# Double Click Field Editing

## Context
The requested change is to let users enter edit mode by double-clicking fields that already expose a pencil-edit affordance, so users can edit immediately without moving to the pencil button. The confirmed scope is every visible pencil-edit field path found under `src/`: transaction history rows, setup accounts, setup categories, setup subcategories, and settings tags. The intended end state is that double-click and the existing pencil button enter the exact same edit state, with no new editable entities and no bypass of system-row restrictions.

## Approach
1. Add one shared double-click eligibility helper and test it before wiring components.
   - Create `src/lib/fieldEditDoubleClick.ts`.
   - Export exactly:
     ```ts
     interface FieldEditDoubleClickEvent {
       defaultPrevented?: boolean;
       target: EventTarget | null;
     }
     
     export function shouldHandleFieldEditDoubleClick(
       event: FieldEditDoubleClickEvent,
     ): boolean;
     ```
   - The function returns `false` when `event.defaultPrevented` is truthy.
   - The function returns `false` when `typeof Element !== "undefined"`, `event.target instanceof Element`, and `event.target.closest(ignoredFieldEditDoubleClickTargetSelector)` matches.
   - Define `ignoredFieldEditDoubleClickTargetSelector` exactly as:
     ```ts
     'button, a, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"], [data-field-edit-double-click-ignore="true"]'
     ```
   - Otherwise return `true`.
   - Create `src/lib/fieldEditDoubleClick.test.ts` using the existing `node:test` + `node:assert/strict` style from `src/lib/enterSave.test.ts`. Cover: plain non-interactive target returns `true`; `defaultPrevented` returns `false`; nested button target returns `false`; nested input/select/contenteditable targets return `false`; absence of `globalThis.Element` still returns `true` for a plain object target. Use `afterEach` to restore/delete `globalThis.Element` exactly like `enterSave.test.ts`.

2. Wire `src/components/features/TransactionTable.tsx` for Transaction History editable cells.
   - Import `shouldHandleFieldEditDoubleClick` from `@/lib/fieldEditDoubleClick`.
   - Reuse the existing `startEdit = useCallback((t: TransactionWithDetails) => { ... }, [])` at `TransactionTable.tsx:305`; do not add new edit state and do not change `saveEdit`.
   - Add `onDoubleClick` only to non-action cells that switch to edit controls under `editingId === t.id`:
     - date `<td>` around `TransactionTable.tsx:1210`;
     - name/comment `<td>` around `TransactionTable.tsx:1238`;
     - amount `<td>` around `TransactionTable.tsx:1300`;
     - kind/type `<td>` around `TransactionTable.tsx:1350`;
     - subcategory `<td>` around `TransactionTable.tsx:1389`;
     - tags `<td>` around `TransactionTable.tsx:1432`.
   - Each handler must be the same behavior:
     ```tsx
     onDoubleClick={(event) => {
       if (isEditing) return;
       if (!shouldHandleFieldEditDoubleClick(event)) return;
       startEdit(t);
     }}
     ```
   - Do not add double-click handlers to the checkbox cell, account cell, running-balance cell, category display cell, save/cancel/edit/delete actions cell, or table row itself. This preserves spreadsheet selection and avoids editing when users double-click non-editable transaction fields.
   - Keep existing `getHistoryCellSelectionHandlers(...)`, `onPaste`, `onFocus`, and `tabIndex` props on the same cells; add `onDoubleClick` alongside them without replacing any existing handler.

3. Wire `src/pages/SetupPage.tsx` for setup accounts, categories, and subcategories.
   - Import `shouldHandleFieldEditDoubleClick` from `@/lib/fieldEditDoubleClick` near the existing `handleEnterSave` import.
   - Accounts: reuse `function startEdit(a: AccountWithBalance)` at `SetupPage.tsx:774`; add `onDoubleClick` to the non-editing account cells for name (`EntityLabel` cell around `SetupPage.tsx:1244`), type (`TypeBadge` cell around `SetupPage.tsx:1247`), color (`ColorPicker` cell around `SetupPage.tsx:1250`), and initial balance (`formatCurrency(a.initial_balance)` cell around `SetupPage.tsx:1259`). The handler calls `startEdit(a)` only when `shouldHandleFieldEditDoubleClick(event)` returns `true`.
   - Accounts: do not add handlers to the selection checkbox cell, reconcile/current-value button, current balance cell, or actions cell. The color cell handler is allowed on the `<td>` because the helper ignores the nested `ColorPicker` button.
   - Categories: reuse `function startEdit(c: Category)` at `SetupPage.tsx:1709`; add `onDoubleClick` to non-editing category name, type, and color cells around `SetupPage.tsx:2017`, `2026`, and `2029`. The handler must first preserve the pencil visibility rule:
     ```tsx
     if (c.is_system) return;
     if (!shouldHandleFieldEditDoubleClick(event)) return;
     startEdit(c);
     ```
   - Categories: do not add handlers to system category rows, the selection checkbox cell, or the actions cell.
   - Subcategories: reuse `function startEdit(s: Subcategory)` at `SetupPage.tsx:2398`; add `onDoubleClick` to non-editing subcategory name, parent category/type, monthly goal, and color cells around `SetupPage.tsx:2745`, `2754`, `2768`, and `2775`. The handler must first preserve the pencil visibility rule:
     ```tsx
     if (s.is_system) return;
     if (!shouldHandleFieldEditDoubleClick(event)) return;
     startEdit(s);
     ```
   - Subcategories: do not add handlers to system subcategory rows, the selection checkbox cell, or the actions cell. The color cell handler is allowed on the `<td>` because the helper ignores the nested `ColorPicker` button.

4. Wire `src/components/features/TagManager.tsx` for settings tags.
   - Import `shouldHandleFieldEditDoubleClick` from `@/lib/fieldEditDoubleClick`.
   - Reuse `const startEdit = (tag: Tag) => { ... }` at `TagManager.tsx:74`; do not add tag edit state and do not change `saveEdit`.
   - Add `onDoubleClick` to the non-editing tag cells for tag chip/name (`TagManager.tsx:332`), type (`TagManager.tsx:344`), and color swatch (`TagManager.tsx:360`).
   - Each handler must call `startEdit(tag)` only when `!isEditing` and `shouldHandleFieldEditDoubleClick(event)` is true.
   - Do not add a handler to the actions cell; the existing pencil/delete buttons remain click-only controls.

5. Keep the edit behavior cleanly cut over to the existing paths.
   - Do not change `src/components/ui/Button.tsx`; it is generic and cannot know which buttons are edit affordances.
   - Do not dispatch shortcut commands from double-click handlers; the component-local `startEdit(...)` calls already receive the correct row object.
   - Do not include `src/components/features/MultiTransactionTable.tsx`, `src/components/features/BulkEditModal.tsx`, or `src/pages/SettingsPage.tsx` shortcut-binding `Edit` buttons in the implementation; they are not visible pencil-edit field affordances for this request.
   - Preserve existing save/cancel keyboard behavior through `handleEnterSave` and existing shortcut registrations; double-click only changes how edit mode starts.

## Critical files & anchors
- `src/lib/fieldEditDoubleClick.ts` — new shared guard that prevents double-click edit from firing from nested buttons, inputs, selects, links, contenteditable elements, and explicit ignore markers.
- `src/components/features/TransactionTable.tsx:305` and `:1210-1460` — transaction `startEdit(t)` and the six display cells that become edit controls; avoids non-editable transaction cells and action controls.
- `src/pages/SetupPage.tsx:774`, `:1709`, `:2398`, and the non-editing row branches around `:1233-1291`, `:2005-2058`, `:2733-2804` — three separate setup edit flows and their system-row gating.
- `src/components/features/TagManager.tsx:74` and `:332-380` — tag `startEdit(tag)` and the non-editing tag display cells.
- `src/lib/enterSave.test.ts` — test style and `globalThis.Element` restoration pattern to copy for the new helper test.

## Verification
Run from `C:/Users/joesa/Code/localfin-ai`.

1. Focused automated checks:
   - `node --import tsx --test src/lib/fieldEditDoubleClick.test.ts`
   - Expected: all helper tests pass, proving interactive descendants and `defaultPrevented` events do not trigger edit.

2. Frontend/project checks:
   - `npm run test:frontend`
   - `npm run typecheck`
   - `npm run lint`
   - Expected: no failures. `test:frontend` uses `node --import tsx --test "src/**/*.test.ts"`, so the new `.test.ts` helper test is included.

3. Manual browser smoke with the app running:
   - Start the app with `npm run dev` from the repo root. The existing Vite app is served at `http://127.0.0.1:5173`; backend health must be reachable on port `3001`.
   - `/setup`: double-click an account name, type, color cell outside the color button itself, and initial balance. Expected: the same row switches to the existing account edit inputs/buttons. Double-click the account checkbox, current balance, reconcile button, edit/delete buttons, and the nested color picker button. Expected: those controls keep their current behavior and do not start row edit from the double-click handler.
   - `/setup`: double-click a non-system category name/type/color cell. Expected: category edit controls appear. Double-click a locked/system category row. Expected: no edit controls appear because no pencil exists for that row.
   - `/setup`: double-click a non-system subcategory name, parent category/type, monthly goal, or color cell. Expected: subcategory edit controls appear. Double-click a locked/system subcategory row. Expected: no edit controls appear.
   - `/settings`: if the Tags table is empty, create a temporary tag using the existing tag creation controls in the Tags card. Double-click the tag chip/name, type, and color swatch cells. Expected: the same tag row switches to the existing tag edit inputs/select/color picker. Double-click the edit/delete action buttons. Expected: only their existing button behavior runs.
   - `/transactions/history`: if the history table is empty, create a disposable transaction first at `/transactions/input` by filling the first manual-entry row with Date, Name, Amount, Type, Account, and Subcategory, then click `Save All` and return to `/transactions/history`. Double-click the transaction date, name/comment, amount, type, subcategory, and tags cells. Expected: the same row switches to the existing transaction edit controls. Double-click the checkbox, account, running balance, category display, and action buttons. Expected: those do not start edit via the double-click handler.

4. Regression checks while manually smoking:
   - In Transaction History, click/drag spreadsheet-style cell selection still works on cells with `getHistoryCellSelectionHandlers(...)`.
   - In Transaction History, paste into the subcategory cell still reaches the existing `applySubcategoryPaste` path.
   - Save and Cancel buttons still close edit mode through the existing save/cancel paths after a row was opened by double-click.

## Assumptions & contingencies
- Scope decision: cover all fields behind visible pencil-edit affordances, not text-only `Edit` buttons or already-inline editable grids. If another pencil icon is added before implementation, include it only if it is a visible field-level edit affordance and wire it to its existing edit handler.
- The chosen trigger surface is cell-level, not whole-row. This intentionally avoids double-click edit on non-editable cells such as transaction account/running balance/category, setup current balance, selection checkboxes, and action buttons.
- If TypeScript rejects the helper interface because React’s `MouseEvent` type is more specific than the helper’s structural event type, widen only the helper input to `Pick<React.MouseEvent<HTMLElement>, "defaultPrevented" | "target">` via a type-only import in `fieldEditDoubleClick.ts`; keep the runtime behavior and exported function name unchanged.
- If manual transaction verification cannot create a disposable transaction because account/category fixtures are missing, first create the minimum account/category/subcategory through `/setup`, then create the transaction through `/transactions/input`; delete the disposable records after verification using existing UI delete controls.
