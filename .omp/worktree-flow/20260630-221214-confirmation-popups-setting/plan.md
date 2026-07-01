# Confirmation Popups Setting

## Context
Add one Settings option that globally turns non-critical success confirmation popups on or off. The fixed scope is success confirmations only: Sonner `toast.success(...)` popups for successful saves, creates, updates, deletes, syncs, parses, scans, and similar completion messages are gated; `toast.error(...)`, `toast.warning(...)`, and destructive confirmation dialogs remain visible. Current notification hosting is Sonner via `package.json` dependency `"sonner": "^2.0.7"` and `src/App.tsx` rendering `<Toaster theme="dark" position="bottom-right" />`.

## Approach
### Persist one global UI preference
1. In `src/features/display-settings/storage.ts`, extend `DisplaySettings` with the exact field `successConfirmationPopupsEnabled: boolean`.
2. In `defaultDisplaySettings()`, default `successConfirmationPopupsEnabled` to `true` so existing users keep current behavior.
3. In `readDisplaySettings()`, migrate old localStorage payloads without a storage-key change by reading the field as `successConfirmationPopupsEnabled: parsed.successConfirmationPopupsEnabled !== false`. This preserves `false`, treats missing/invalid/non-boolean values as enabled, and keeps `STORAGE_KEY = "localfin.display.v1"` because the field is additive.
4. Leave `writeDisplaySettings()` on the current spread/write pattern so the new field persists with `version: STORAGE_VERSION` and refreshed `updatedAt`.
5. In `src/features/display-settings/DisplaySettingsContext.ts`, add the exact setter signature to `DisplaySettingsContextValue`: `setSuccessConfirmationPopupsEnabled: (enabled: boolean) => void`.
6. In `src/features/display-settings/DisplaySettingsProvider.tsx`, add `setSuccessConfirmationPopupsEnabled` beside `setAmountGradientEnabled` using the existing write-through pattern: `updateSettings({ ...settings, successConfirmationPopupsEnabled: enabled })`.
7. In `DisplaySettingsProvider`, include `setSuccessConfirmationPopupsEnabled` in the memoized context value and dependency list.
8. Update `resetAmountGradientSettings()` so the Transaction Amount Colors reset does not unexpectedly reset the popup setting. Replace the current `updateSettings(defaultDisplaySettings())` behavior with an object that uses default amount-gradient/color values but preserves `settings.successConfirmationPopupsEnabled`. Dependency list must include `settings.successConfirmationPopupsEnabled`.

### Add the single Settings control
1. In `src/pages/SettingsPage.tsx`, add a new card immediately after the API Key card and before the Assistant card.
2. Use this exact card title: `Interface`.
3. Reuse the existing checkbox styling from the Transaction Amount Colors card: `label` class `inline-flex items-center gap-2 text-sm text-muted-foreground`, `input` type `checkbox`, and input class `h-4 w-4 rounded border-border bg-background`.
4. Bind the checkbox to `displaySettings.successConfirmationPopupsEnabled`.
5. On change, call `displaySettings.setSuccessConfirmationPopupsEnabled(event.target.checked)`.
6. Use this exact visible label text: `Show success confirmation popups`.
7. Add helper text under the checkbox: `When off, successful save/create/update/delete popups are hidden. Errors, warnings, and destructive confirmations still appear.`
8. Do not add separate toggles for saves, tags, accounts, syncs, scans, deletes, warnings, or errors.

### Centralize success-toast gating
1. In `src/features/display-settings/hooks.ts`, import `useCallback` from React in addition to `useContext`, and import `toast` from `sonner`.
2. Add this exported hook in the same file after `useDisplaySettings()` and before `useAmountGradient()`:
   - `export function useSuccessToast()`
   - It reads `successConfirmationPopupsEnabled` from `useDisplaySettings()`.
   - It returns a memoized callback with signature `(message: string) => ReturnType<typeof toast.success> | undefined`.
   - The callback returns `undefined` without calling Sonner when `successConfirmationPopupsEnabled` is false.
   - The callback calls and returns `toast.success(message)` when `successConfirmationPopupsEnabled` is true.
3. Do not gate `toast.error` or `toast.warning` in this hook.
4. Do not move `<Toaster />` in `src/App.tsx`; all target callsites are below `DisplaySettingsProvider`, and the root Sonner host can stay where it is.

### Migrate every success confirmation callsite
1. Run the exact search `toast\\.success` over `src` before editing and use the list below as the required migration set. The final search after migration must show no direct `toast.success` outside `src/features/display-settings/hooks.ts`.
2. In each migrated component/function, add `const successToast = useSuccessToast();` at the component top level, then replace direct `toast.success(...)` with `successToast(...)`. Keep existing `toast` imports where the file still uses `toast.error(...)` or `toast.warning(...)`.
3. In `src/components/features/MultiTransactionTable.tsx`, import `useSuccessToast` from `@/features/display-settings/hooks`, add one `successToast` in `MultiTransactionTable`, and replace success calls at current lines 1011, 1057, 1137, and 1232.
4. In `src/components/features/TagManager.tsx`, import `useSuccessToast`, add one `successToast` in `TagManager`, and replace success calls at current lines 85, 108, and 130.
5. In `src/components/features/TransactionTable.tsx`, extend the existing `@/features/display-settings/hooks` import from `useAmountGradient` to `useAmountGradient, useSuccessToast`, add one `successToast` in `TransactionTable`, and replace success calls at current lines 793 and 849.
6. In `src/pages/TransactionHistoryPage.tsx`, import `useSuccessToast`, add one `successToast` in `TransactionHistoryPage`, and replace success calls at current lines 188, 204, 219, 232, 266, 328, and 338-340. Preserve the existing `if (!options?.silent)` guard around the single-row update success message.
7. In `src/pages/TransactionInputPage.tsx`, import `useSuccessToast`, add one `successToast` in `TransactionInputPage`, and replace the success call at current lines 29-31.
8. In `src/pages/SetupPage.tsx`, import `useSuccessToast` once. Add `successToast` in each function component that emits success toasts, then replace the success calls in that component:
   - `PlaidConnectButton`: current line 237.
   - `AccountsSection`: current lines 500, 531, 545, 578, 621, 634, and 1259-1263.
   - `CategoriesSection`: current lines 1447, 1474, 1488, and 1521.
   - `SubcategoriesSection`: current lines 2044, 2073, 2087, and 2120.
   - `SetupPage`: current line 2610.
9. Leave `src/components/features/ChatSidePanel.tsx` unchanged because it has only warning/error Sonner calls.
10. Leave `src/components/features/ConfirmDeleteModal.tsx`, `src/components/ui/Modal.tsx`, and all destructive delete confirmation modal callsites unchanged; those are action gates, not success popups.

### Add targeted tests
1. Add `src/features/display-settings/storage.test.ts` using the existing Node test style from `src/features/table-layout/storage.test.ts`: `/// <reference types="node" />`, `node:assert/strict`, `node:test`, an in-memory storage class, `beforeEach`, and `afterEach`.
2. Because `display-settings/storage.ts` reads `window.localStorage`, the test setup must define `globalThis.window` with `{ localStorage: storage }` by `Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } })`; cleanup must `Reflect.deleteProperty(globalThis, "window")`.
3. The storage tests must cover these exact cases:
   - Missing storage returns `successConfirmationPopupsEnabled === true`.
   - Old stored JSON without `successConfirmationPopupsEnabled` returns `true` and preserves existing amount color fields.
   - Stored JSON with `"successConfirmationPopupsEnabled": false` returns `false`.
   - `writeDisplaySettings({ ...defaultDisplaySettings(), successConfirmationPopupsEnabled: false })` persists a JSON payload whose `successConfirmationPopupsEnabled` is `false`.
4. Do not add a separate notification store or backend-backed test fixture for this change; the behavior is covered by the centralized hook, the storage tests above, and the manual UI smoke test below.

## Critical files & anchors
- `src/features/display-settings/storage.ts` — `DisplaySettings`, `defaultDisplaySettings`, `readDisplaySettings`, and `writeDisplaySettings`; this is the existing localStorage JSON store at key `localfin.display.v1`.
- `src/features/display-settings/DisplaySettingsContext.ts` — `DisplaySettingsContextValue`; this is the context contract all display/UI settings consumers receive.
- `src/features/display-settings/DisplaySettingsProvider.tsx` — `DisplaySettingsProvider`, `updateSettings`, `resetAmountGradientSettings`, and the memoized `value`; this is the app-wide state/write-through provider already wrapping `Router` in `src/App.tsx`.
- `src/features/display-settings/hooks.ts` — `useDisplaySettings()` and `useAmountGradient()`; add the success-toast hook here so all callsites reuse one setting check.
- `src/pages/SettingsPage.tsx` — `SettingsPage`; add the single `Interface` card after the API Key card and before the Assistant card, using existing checkbox/card conventions.

## Verification
1. Static migration check: search `toast\\.success` under `src`. Expected result after implementation: exactly one direct `toast.success` reference in `src/features/display-settings/hooks.ts`; no direct success call remains in the six migrated feature/page files.
2. Frontend tests: run `npm run test:frontend` from `C:/Users/joesa/Code/localfin-ai`. Expected: existing tests plus the new `src/features/display-settings/storage.test.ts` pass.
3. Typecheck: run `npm run typecheck` from `C:/Users/joesa/Code/localfin-ai`. Expected: no TypeScript errors, especially around `DisplaySettingsContextValue`, `useSuccessToast`, and migrated callsites.
4. Lint: run `npm run lint` from `C:/Users/joesa/Code/localfin-ai`. Expected: no lint errors, no unused `toast` imports, no missing hook dependencies.
5. Manual UI smoke test with the app running (`npm run dev` with the usual `.env` containing `OPENROUTER_API_KEY` if server startup requires it):
   - Open `/settings`.
   - Confirm the new `Interface` card contains exactly one checkbox labeled `Show success confirmation popups`.
   - Turn the checkbox off.
   - In the same Settings page, create a tag in the Tags section with a unique name. Expected: tag is created and no `Tag created` Sonner success popup appears.
   - Trigger a validation error by attempting to create a tag with an empty name. Expected: `Tag name is required` error popup still appears.
   - Start a tag delete action. Expected: the destructive delete confirmation modal still appears before deletion.
   - Turn the checkbox back on and create another unique tag. Expected: the `Tag created` success popup appears.
6. Storage persistence smoke check during the manual test: reload `/settings` after turning the checkbox off. Expected: the checkbox remains off because `localfin.display.v1` persisted `successConfirmationPopupsEnabled: false`.

## Assumptions & contingencies
- Scope is fixed by user selection: one setting gates success confirmations only. Errors, warnings, inline status messages, and destructive confirmation dialogs are not gated.
- Persistence stays client-local in `localStorage` because all comparable frontend settings already use localStorage and no backend settings route exists in `server/app.ts`.
- The field name is `successConfirmationPopupsEnabled`; if implementation discovers a naming collision, use `confirmationPopupsEnabled` everywhere instead, but still keep the visible label `Show success confirmation popups` and the same success-only behavior.
- If a new `toast.success(...)` callsite appears before implementation, migrate it to `useSuccessToast()` too. The acceptance criterion is the final `toast\\.success` search, not only the line numbers in this plan.
