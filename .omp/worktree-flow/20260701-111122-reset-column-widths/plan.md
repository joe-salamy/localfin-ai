# Reset Column Widths

## Context

The feature request is to add a Settings button that resets saved draggable table column widths back to defaults. The requested scope is global: one reset clears all saved widths for every resizable table, not only the table visible on the Settings page. The default-width policy is to use the existing code-defined `ResizableColumnDef.defaultWidth` values and not introduce a single universal width; `src/features/table-layout/useResizableColumns.ts` already resolves defaults as `persistedWidth ?? def.defaultWidth`, clamped to `def.minWidth ?? 48` and `def.maxWidth ?? 640`.

The optimal default width is therefore the current per-column default, not one width for every column. Existing defaults are content-sized: selection/expander/icon columns effectively reset to 48px, numeric/action columns mostly reset to 96-140px, and text/name/category columns reset to 160-320px. Do not change column definitions in this feature.

## Approach

### Add a reset API in table-layout storage

1. In `src/features/table-layout/storage.ts`, extend the private `BrowserStorage` interface with optional `removeItem?: (key: string) => void`; keep `isBrowserStorage()` requiring only `getItem` and `setItem` so existing storage shims remain valid.
2. Add a module-level reset subscriber set and export this exact function:
   ```ts
   export function subscribeToTableColumnWidthReset(
     listener: () => void,
   ): () => void;
   ```
   It adds the listener to the set and returns an unsubscribe function that deletes it. No DOM event is required; this only needs to notify mounted hooks in the same app runtime after the Settings button is clicked.
3. Export this exact function:
   ```ts
   export function resetAllTableColumnWidths(): void;
   ```
   It must:
   - call `getTableColumnWidthStorage()`;
   - if storage exists and `removeItem` is a function, call `storage.removeItem("localfin.table-column-widths.v1")`;
   - otherwise, if storage exists, call `storage.setItem("localfin.table-column-widths.v1", JSON.stringify(defaultTableColumnWidths()))` so `tables` becomes `{}`;
   - catch storage errors the same way `writeTableColumnWidths()` does, because storage can be unavailable even when the API object exists;
   - notify every reset subscriber after the storage attempt, including when storage is unavailable, so in-memory resized tables return to defaults.
4. Do not add a new default-width map. Resetting means clearing persisted overrides for key `localfin.table-column-widths.v1`; `readTableColumnWidths(tableId)` returning `{}` is what makes `useResizableColumns()` use each table's existing defaults.

### Make mounted resizable tables observe the reset

1. In `src/features/table-layout/useResizableColumns.ts`, import `subscribeToTableColumnWidthReset` beside `readTableColumnWidths` and `writeTableColumnWidths`.
2. Replace the current table-id-only refresh effect:
   ```ts
   useEffect(() => {
     setWidths(readTableColumnWidths(tableId));
   }, [tableId]);
   ```
   with one effect that refreshes on `tableId` changes and on global reset:
   ```ts
   useEffect(() => {
     const refreshWidths = () => setWidths(readTableColumnWidths(tableId));
     refreshWidths();
     return subscribeToTableColumnWidthReset(refreshWidths);
   }, [tableId]);
   ```
3. Keep drag behavior unchanged: `onPointerDown` still updates local state immediately and persists via `writeTableColumnWidths(tableId, buildWidthRecord(nextColumns))`. Do not emit the reset subscriber from normal writes; global reset is the only cross-table notification this feature needs.
4. Edge handling: if storage is missing or throws, the reset subscriber still sets each mounted hook's `widths` state to `{}` through `readTableColumnWidths(tableId)`, so the UI returns to defaults even when persistence cannot be cleared.

### Add the Settings button

1. In `src/pages/SettingsPage.tsx`, import `resetAllTableColumnWidths` from `@/features/table-layout/storage`.
2. Add local state near the other Settings messages:
   ```ts
   const [tableLayoutMessage, setTableLayoutMessage] = useState("");
   ```
3. Add a callback near the existing reset callbacks:
   ```ts
   const resetColumnWidths = useCallback(() => {
     resetAllTableColumnWidths();
     setTableLayoutMessage("Column widths reset to defaults.");
   }, []);
   ```
4. Insert the control inside the existing `Interface` card, after the success-popup explanatory paragraph and before that card's `</CardContent>`. Use the existing reset style: `Button type="button" variant="secondary"` with `RotateCcw className="mr-1 h-3.5 w-3.5"`.
5. Use this exact visible copy so the scope is clear:
   - Heading text: `Table column widths`
   - Help text: `Restore all resizable tables to their default column widths.`
   - Button label: `Reset Column Widths`
   - Confirmation message: `Column widths reset to defaults.`
6. Render the confirmation message only when `tableLayoutMessage` is non-empty, using the existing Settings message style:
   ```tsx
   <p
     className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground"
     aria-live="polite"
   >
     {tableLayoutMessage}
   </p>
   ```
7. Do not use `variant="destructive"` and do not add a confirmation modal; existing Settings reset controls use secondary styling and reset actions are reversible by dragging columns again.

### Update storage tests

1. In `src/features/table-layout/storage.test.ts`, import `resetAllTableColumnWidths` and `subscribeToTableColumnWidthReset` from `./storage`.
2. Add `removeItem(key: string): void { delete this.items[key]; }` to `MemoryStorage`, and override `removeItem(): void { throw new Error("storage unavailable"); }` in `ThrowingStorage` so reset error handling is exercised.
3. Add a test named exactly `resets all persisted widths and notifies subscribers`:
   - write widths for at least two table IDs with `writeTableColumnWidths("first", { name: 180 })` and `writeTableColumnWidths("second", { date: 112 })`;
   - subscribe with a listener that increments a counter;
   - call `resetAllTableColumnWidths()`;
   - assert `readAllTableColumnWidths().tables` deep-equals `{}`;
   - assert `storage.getItem(STORAGE_KEY)` is `null` when `removeItem` exists;
   - assert the listener counter is `1`;
   - call the unsubscribe function, call `resetAllTableColumnWidths()` again, and assert the counter remains `1`.
4. Add a test named exactly `reset falls back to an empty width payload when removeItem is unavailable`:
   - install a storage object that has `getItem` and `setItem` but no `removeItem`;
   - write at least one table width;
   - call `resetAllTableColumnWidths()`;
   - parse `storage.getItem(STORAGE_KEY)` and assert `tables` deep-equals `{}` and `version` is `1`.
5. Keep the existing unavailable-storage test and add `assert.doesNotThrow(() => resetAllTableColumnWidths())` inside it; this verifies reset follows the same no-throw contract as writes.

## Current table IDs and defaults to preserve

Do not change these defaults for this feature; reset should reveal them by clearing saved widths.

- `transaction-history.transactions` (`src/components/features/TransactionTable.tsx`): `select` 48, `date` 128, `account` 160, `name` 220, `amount` 112, `balance` 112, `category` 160, `kind` 112, `subcategory` 180, `tags` 200, `actions` 96.
- `transaction-input.manual-entry` (`src/components/features/MultiTransactionTable.tsx`): `indicator` 32, `date` 112, `name` 176, `amount` 96, `kind` 96, `account` 128, `subcategory` 144, `tags` 176, `comment` 128, `remove` 32. Effective reset width for `indicator` and `remove` is 48 because `useResizableColumns()` clamps to the default minimum.
- `transaction-input.recent-activity` (`src/components/features/RecentAccountTransactionsTable.tsx`): `account` 180, `date` 112, `latestTransaction` 240, `amount` 112, `currentBalance` 128.
- `dashboard.account-summary` (`src/components/features/AccountSummary.tsx`): `expander` 48, `account` 180, `type` 96, `starting` 128, `change` 128, `ending` 128.
- `dashboard.account-summary.transactions` (`src/components/features/AccountSummary.tsx`): `date` 112, `name` 220, `amount` 112, `balance` 112, `category` 180.
- `dashboard.category-summary` (`src/components/features/CategorySummary.tsx`): `expander` 48, `category` 180, `type` 96, `total` 128, `goal` 128, `difference` 128.
- `dashboard.category-summary.subcategories` (`src/components/features/CategorySummary.tsx`): `subcategory` 200, `total` 128, `goal` 128, `difference` 128.
- `dashboard.tag-summary` (`src/components/features/TagSummary.tsx`): `expander` 48, `tag` 180, `type` 112, `spend` 128, `income` 128, `net` 128, `count` 96.
- `dashboard.tag-summary.categories` (`src/components/features/TagSummary.tsx`): `category` 200, `spend` 128, `income` 128, `net` 128, `count` 96.
- `settings.tags` (`src/components/features/TagManager.tsx`): `tag` 220, `type` 112, `color` 96, `actions` 96.
- `settings.shortcuts` (`src/pages/SettingsPage.tsx`): `command` 320, `scope` 140, `default` 140, `current` 180, `actions` 128.
- `setup.accounts` (`src/pages/SetupPage.tsx`): `select` 48, `name` 180, `type` 112, `color` 96, `initialBalance` 140, `balance` 140, `actions` 112.
- `setup.categories` (`src/pages/SetupPage.tsx`): `select` 48, `name` 200, `type` 112, `color` 96, `actions` 96.
- `setup.subcategories` (`src/pages/SetupPage.tsx`): `select` 48, `name` 200, `category` 180, `monthlyGoal` 140, `color` 96, `actions` 96.

## Critical files & anchors

- `src/features/table-layout/storage.ts` — `STORAGE_KEY`, `BrowserStorage`, `readAllTableColumnWidths()`, `writeTableColumnWidths()`; add reset and subscription APIs here so Settings does not manipulate localStorage directly.
- `src/features/table-layout/useResizableColumns.ts` — `useResizableColumns(tableId, columnDefs)` state/effect and `resolveColumn()` default behavior; subscribe mounted tables to reset without changing drag persistence.
- `src/pages/SettingsPage.tsx` — `SettingsPage()` Interface card and reset button patterns; add the global reset UI inside the Interface card.
- `src/features/table-layout/storage.test.ts` — existing Node test harness for table-width storage; add reset persistence and subscriber tests here.
- `package.json` — verification scripts: `test:frontend`, `typecheck`, and `lint`.

## Verification

Run commands from the repo root `C:/Users/joesa/Code/localfin-ai`.

1. Targeted storage behavior:
   ```bash
   node --import tsx --test src/features/table-layout/storage.test.ts
   ```
   Expected: existing tests pass, the new reset tests prove all table IDs are cleared, subscribers fire once, unsubscribed listeners stop firing, unavailable storage does not throw, and storage without `removeItem` persists an empty `{ tables: {} }` payload.
2. Frontend storage suite:
   ```bash
   npm run test:frontend
   ```
   Expected: all `src/**/*.test.ts` tests pass.
3. TypeScript:
   ```bash
   npm run typecheck
   ```
   Expected: no TypeScript errors from the new exports/imports/effects.
4. Lint:
   ```bash
   npm run lint
   ```
   Expected: no ESLint errors.
5. Manual UI smoke test for the new behavior:
   - Start the app using the repo's normal dev flow if backend access is available:
     ```bash
     npm run dev
     ```
     If only the client is needed for this UI smoke, `npm run dev:client` is sufficient to load `/settings`, but backend-backed sections such as tags may show fetch errors.
   - Open `http://127.0.0.1:5173/settings`.
   - Drag a visible column edge in the Keyboard Shortcuts table so `localStorage.getItem("localfin.table-column-widths.v1")` contains a `settings.shortcuts` entry.
   - Click `Reset Column Widths` in the Interface card.
   - Expected: the confirmation message `Column widths reset to defaults.` appears, `localStorage.getItem("localfin.table-column-widths.v1")` is `null` when `removeItem` is available, and the Keyboard Shortcuts table returns to the defaults `command` 320, `scope` 140, `default` 140, `current` 180, `actions` 128 without requiring a page reload.

## Assumptions & contingencies

- Existing per-column defaults are the optimal reset target. A universal default width is intentionally not added because current tables already use content-specific defaults and `useResizableColumns()` has the defaulting logic.
- If implementation re-reading finds another resizable table added since this plan, do not special-case it; it is automatically reset by clearing `localfin.table-column-widths.v1` because widths are keyed by table ID inside that one payload.
- If a browser-like storage shim lacks `removeItem`, the reset must write `defaultTableColumnWidths()` instead of failing; tests cover this branch.
- If mounted tables do not visually reset after the Settings click, the missing piece is the subscriber path in `useResizableColumns.ts`; do not solve it by forcing a page reload or remounting Settings.
