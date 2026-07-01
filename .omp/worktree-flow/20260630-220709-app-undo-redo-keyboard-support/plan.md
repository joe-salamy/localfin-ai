# App Undo Redo Keyboard Support

## Context

Add application-wide undo/redo keyboard support for user-controlled LocalFin edits. Ctrl+Z and Cmd+Z undo; Ctrl+Shift+Z, Cmd+Shift+Z, and Ctrl+Y redo. The current app already has an app-wide shortcut registry in `src/features/shortcuts` mounted by `src/App.tsx`, but it supports exactly one binding per command; the current finance mutations are React Query mutations with broad invalidation and no undo/restore API. The intended end state is one global undo/redo history that preserves native text-field undo, supports safe finance/data-entry operations across the routed app, and leaves external provider sync/OAuth and opaque AI chat mutations out until those flows expose reversible action details.

## Approach

### 1. Extend shortcut commands to support default aliases

1. In `src/features/shortcuts/commands.ts`, add `CommandId` members `"global.undo"` and `"global.redo"` and keep them in `CommandCategory` `"Global"` and `CommandScope` `"global"`. Add definitions near the other global commands:
   - Undo label `"Undo"`, description `"Undo the last app action."`, default keys `["Ctrl+Z", "Meta+Z"]`.
   - Redo label `"Redo"`, description `"Redo the last undone app action."`, default keys `["Ctrl+Shift+Z", "Ctrl+Y", "Shift+Meta+Z"]`.
   - Use `"Shift+Meta+Z"` in code because `normalizeShortcutParts()` currently emits modifiers in `Ctrl`, `Alt`, `Shift`, `Meta` order; this is the normalized form of user-facing Cmd+Shift+Z.
   - Leave `inputSafe` unset so existing editable-target filtering preserves native browser undo/redo inside `input`, `textarea`, `select`, and `contenteditable`.
2. Replace the single-default shortcut model with plural defaults while keeping one custom override per command:
   - Change `CommandDefinition.defaultBinding: ShortcutBinding | null` to `defaultBindings: readonly ShortcutBinding[]`.
   - Change `command(..., key: string | null, ...)` to accept `key: string | readonly string[] | null` and normalize it into `defaultBindings`.
   - Keep `ShortcutBinding` as `{ key: string }`; do not introduce platform-specific binding objects.
   - Add `displayShortcutList(bindings: readonly ShortcutBinding[]): string` and `ariaKeyShortcutList(bindings: readonly ShortcutBinding[]): string | undefined` in `src/features/shortcuts/normalize.ts`; join display labels with `" / "` and ARIA tokens with spaces.
3. Update `src/features/shortcuts/ShortcutContext.ts`, `ShortcutProvider.tsx`, `hooks.ts`, `ShortcutHint.tsx`, and `src/pages/SettingsPage.tsx` together:
   - Add `getShortcuts(commandId: CommandId): readonly ShortcutBinding[]` to `ShortcutContextValue`.
   - Keep `getShortcut(commandId)` as a compatibility helper returning the first effective binding or `null`; existing callers such as `ShortcutHint` and `Navbar` may switch to `getShortcuts`/list display where they show labels.
   - Keep `setShortcut(commandId, binding | null)` as a single custom override: a custom binding replaces all defaults for that command; `null` disables all bindings; `resetShortcut` restores all default bindings.
   - Change conflict checking to `getConflicts(commandId, bindings: readonly ShortcutBinding[])`, comparing every effective key for overlapping scopes and returning the conflicting command labels. `SettingsPage.commitCapturedShortcut()` passes `binding ? [binding] : []`; shortcut table rows pass `getShortcuts(command.id)`.
   - Change dispatch in `ShortcutProvider` from one `commandBinding.key === binding.key` check to `getShortcuts(command.id).some((candidate) => candidate.key === binding.key)`.
   - Leave storage version/key as `localfin.shortcuts.v1`: existing overrides remain `string | null`, because defaults are not persisted. `toShortcutOverrides()` still parses one stored string into one custom binding; `buildShortcutSettings()` still serializes the first custom binding or null. This avoids a localStorage migration while allowing multi-key defaults.

### 2. Add restore-capable backend/API paths for reversible deletes and creates

1. In `server/services/transactions.ts` and `server/routes/transactions.ts`, add:
   - `restoreTransaction(id: string): TransactionWithDetails` that clears `deleted_at`, updates `updated_at`, verifies the account is active, verifies a non-null subcategory is active, and returns `getTransactionById(id)`.
   - `bulkRestoreTransactions(ids: string[]): TransactionWithDetails[]` that restores each id in one transaction and returns restored rows in request order.
   - `POST /api/transactions/:id/restore` and `POST /api/transactions/bulk/restore` with body `{ ids: string[] }` for the bulk route. Put the bulk restore route before `/:id` routes, matching the existing bulk-route ordering.
2. In `server/services/accounts.ts` and `server/routes/accounts.ts`, add `restoreAccount(id: string): Account` and `POST /api/accounts/:id/restore`. It clears `deleted_at`, updates `updated_at`, checks there is no active account with the same name other than the restored id, and returns the restored row.
3. In `server/services/categories.ts` and `server/routes/categories.ts`, add:
   - `restoreCategory(id: string): Category` and `POST /api/categories/:id/restore`; check no active category with the same `(name, type)` except the restored id.
   - `restoreSubcategory(id: string): Subcategory` and `POST /api/subcategories/:id/restore`; check the parent category is active and no active sibling has the same `(name, category_id)` except the restored id.
4. In `server/services/tags.ts` and `server/routes/tags.ts`, add `restoreTag(id: string): Tag` and `POST /api/tags/:id/restore`; check no active tag with the same normalized `(name, type)` except the restored id.
5. Change `deleteTag(id)` to stop deleting `transaction_tags` rows. `getTagsForTransactions()` already hides soft-deleted tags through `JOIN tags tag ON tag.id = tt.tag_id AND tag.deleted_at IS NULL`, so deleted tags remain invisible while their transaction associations survive for restore. Keep the existing test expectation that `getTransactionById(tagged.id)?.tags` is empty after deleting a tag.
6. In frontend hooks, add matching mutations with the same invalidation groups as the corresponding delete/create mutations:
   - `useTransactions()`: `restoreTransaction`, `bulkRestoreTransactions`.
   - `useAccounts()`: `restoreAccount`.
   - `useCategories()`: `restoreCategory`, `restoreSubcategory`.
   - `useTags()`: `restoreTag`.
   - Add convenience methods in `src/lib/api.ts` only if needed; existing `apiPost` is enough for restore endpoints.

### 3. Add the global undo/redo provider

1. Create `src/features/undo-redo/UndoRedoContext.ts`, `UndoRedoProvider.tsx`, `hooks.ts`, and `history.ts`; no existing equivalent was found.
2. Use this exact public shape:
   ```ts
   export interface UndoableAction {
     id: string;
     label: string;
     apply: () => void | Promise<void>;
     undo: () => void | Promise<void>;
     redo?: () => void | Promise<void>;
   }

   export interface UndoRedoContextValue {
     execute: (action: UndoableAction) => Promise<boolean>;
     undo: () => Promise<boolean>;
     redo: () => Promise<boolean>;
     canUndo: boolean;
     canRedo: boolean;
     isRunning: boolean;
   }
   ```
3. Implement `history.ts` as pure stack helpers and keep React state in `UndoRedoProvider`:
   - `execute()` returns `false` without running when `isRunning` is true; otherwise it runs `action.apply()`, pushes the action onto the undo stack only after success, clears the redo stack, and returns `true`.
   - `undo()` returns `false` when running or the undo stack is empty; otherwise it runs the top action’s `undo()`, moves it to the redo stack only after success, and returns `true`.
   - `redo()` returns `false` when running or the redo stack is empty; otherwise it runs `action.redo ?? action.apply`, moves it back to the undo stack only after success, and returns `true`.
   - If any action function rejects, leave both stacks unchanged, set `isRunning` back to false, and return `false`. Do not add success or no-op toasts. Add only `toast.error("Failed to undo {label}.")` / `toast.error("Failed to redo {label}.")` for rejected keyboard undo/redo, because the app already reports write failures with error toasts.
4. In `UndoRedoProvider`, register:
   - `useShortcut("global.undo", () => void undo(), { enabled: canUndo && !isRunning })`.
   - `useShortcut("global.redo", () => void redo(), { enabled: canRedo && !isRunning })`.
   Existing shortcut dispatch prevents default only when a matching enabled handler is invoked; disabled/no-stack undo therefore does not hijack native behavior.
5. Mount the provider in `src/App.tsx` as a child of `ShortcutProvider` and parent of the existing routed providers:
   ```tsx
   <QueryClientProvider client={queryClient}>
     <ShortcutProvider>
       <UndoRedoProvider>
         <DisplaySettingsProvider>
           <FlaggedWordsProvider>
             <Router />
           </FlaggedWordsProvider>
         </DisplaySettingsProvider>
       </UndoRedoProvider>
     </ShortcutProvider>
     <Toaster theme="dark" position="bottom-right" />
   </QueryClientProvider>
   ```

### 4. Make transaction history operations undoable

1. Add snapshot helpers in `src/features/undo-redo/financeSnapshots.ts`; no existing converter was found. Use exact conversions:
   - `transactionSnapshotToUpdate(transaction: TransactionWithDetails): UpdateTransactionData` returns `{ date, name, amount, kind, subcategory_id, comment, tag_ids: transaction.tags.map((tag) => tag.id), ai_suggested }`.
   - For running balances and display labels (`account_name`, `category_name`, etc.), do not snapshot/restore them; they are derived from refetched queries.
2. In `src/pages/TransactionHistoryPage.tsx`, call `useUndoRedo()` and wrap these handlers:
   - `handleEdit(id, updates, options?)`: find `before` from the current `transactions` array immediately before executing. If not found, fall back to the current non-undoable mutation path and return its boolean result. Otherwise `execute()` an action labeled `"Edit transaction"` where `apply` calls `updateTransaction.mutateAsync({ id, ...updates })`, `undo` calls `updateTransaction.mutateAsync({ id, ...transactionSnapshotToUpdate(before) })`, and `redo` calls the same update as `apply`. Preserve the existing success/error toast behavior only for the initial apply when `options?.silent` is false.
   - `handleDelete(id)`: snapshot the current transaction, execute `"Delete transaction"` with `apply` calling `deleteTransaction`, `undo` calling `restoreTransaction`, and `redo` calling `deleteTransaction`. Keep current selection removal and modal closing after successful apply; do not restore selection on undo.
   - `handleBulkEdit(updates)`: snapshot all selected visible transactions before applying. `apply` and `redo` call `bulkUpdateTransactions.mutateAsync({ ids, updates })`; `undo` loops `updateTransaction.mutateAsync({ id, ...transactionSnapshotToUpdate(before) })` for each snapshot to restore exact tags/kind/subcategory values. Treat the selected set as one undoable action labeled `"Bulk edit transactions"`.
   - `handleBulkDelete()`: snapshot selected visible transactions. `apply` and `redo` call `bulkDeleteTransactions` for the selected/restored ids; `undo` calls `bulkRestoreTransactions` for the same ids. Treat it as one action labeled `"Delete transactions"`.
3. In `src/components/features/TransactionTable.tsx`, add a prop:
   ```ts
   onEditMany: (
     changes: Array<{ id: string; updates: UpdateTransactionData }>,
     options?: { silent?: boolean; label?: string },
   ) => Promise<boolean>;
   ```
   Implement it in `TransactionHistoryPage` with per-id snapshots and one undoable action. Use it for `applySubcategoryPaste`, `applyHistoryClipboardMatrix`, `clearSelectedHistoryCells`, and cut-to-clear flows so a paste/clear/cut across many cells undoes in one Ctrl+Z. Leave single row edit on `onEdit`.
4. For multi-row `onEditMany`, `apply` and `redo` loop `updateTransaction.mutateAsync({ id, ...updates })`; `undo` loops exact `transactionSnapshotToUpdate(before)`. Stop on first failure, invalidate the same query groups through the existing mutation onSuccess handlers, and do not push the action when the initial apply fails.

### 5. Make add-transactions draft and save flows undoable

1. In `src/components/features/MultiTransactionTable.tsx`, use `useUndoRedo()` for discrete app-level draft changes while leaving native text input editing alone:
   - Snapshot `rows`, `duplicatesChecked`, `parseSummary`, `statementText`, and `statementAccountId` before each action.
   - Wrap `addRow`, `removeRow`, `clearAll`, grid paste, grid cut/clear, AI categorization result application, and parse-statement result application as local undoable actions whose `undo` restores the previous snapshot and whose `redo` reapplies the post-action snapshot.
   - Do not wrap per-keystroke `updateRow` text input changes; Ctrl+Z in those fields remains native because undo/redo commands are not `inputSafe`.
2. For `handleSave()`, wrap the successful persisted bulk create as one undoable action labeled `"Save transactions"`:
   - `apply` performs the current duplicate check and `bulkCreateTransactions.mutateAsync(payload)`, stores the created ids returned by `result.data ?? []`, then resets rows as today.
   - `undo` calls `bulkDeleteTransactions.mutateAsync(createdIds)`.
   - `redo` calls `bulkRestoreTransactions.mutateAsync(createdIds)` instead of creating new rows, preserving transaction ids and downstream stack references.
   - If duplicate checking finds duplicates and returns early today, do not push an undo action; the duplicate-marking row-state change is a local draft action only if rows are changed.
3. For tag creation from the input table’s tag picker, wrap `createTag.mutateAsync(data)` as `"Create tag"` with `undo` calling `deleteTag` and `redo` calling `restoreTag` for the created id.

### 6. Make setup and tag settings CRUD undoable

1. In `src/pages/SetupPage.tsx`, wrap account actions:
   - Create account: after `createAccount.mutateAsync` returns an id, push `"Create account"` with `undo` deleting that id and `redo` restoring it.
   - Update account and color picker changes: snapshot the current `AccountWithBalance`; `undo` restores `{ name, type, initial_balance, color }`; `redo` reapplies the submitted changes.
   - Delete account and bulk delete accounts: snapshot selected accounts; `undo` calls `restoreAccount` for each id; `redo` deletes the same ids. Preserve current selection removal; do not restore selection on undo.
   - Reconcile account: if `reconcileAccount` returns `transaction: null`, do not push history. If it returns a transaction id, push `"Reconcile account"` with `undo` deleting that adjustment transaction and `redo` restoring it.
   - Do not make provider OAuth start, provider sync, or provider disconnect undoable; those are external side effects and require provider-specific compensating actions, not local Ctrl+Z.
2. In `src/pages/SetupPage.tsx`, wrap categories and subcategories:
   - Create: undo delete, redo restore the created id.
   - Update and color changes: snapshot current entity and restore all editable fields on undo.
   - Delete and bulk delete: snapshot selected non-system entities; undo restore each id; redo delete each id.
   - Keep existing system entity protections; never add undo actions for operations blocked by `is_system`.
3. In `src/components/features/TagManager.tsx`, wrap tag create/update/delete:
   - Create tag: undo delete, redo restore.
   - Update tag: snapshot `{ name, type, color }`; undo restore the snapshot; redo reapply submitted changes.
   - Delete tag: undo restore the tag id; redo delete it. This depends on the `deleteTag` service change that retains `transaction_tags` rows while tags are soft-deleted.
4. For settings-local actions in `src/pages/SettingsPage.tsx` (`setShortcut`, `resetShortcut`, `resetAllShortcuts`, `flaggedWords.setFlaggedWords`, `flaggedWords.resetFlaggedWords`), do not wire them into undo in this change. They are local preference edits, not finance/data-entry actions, and adding them would let shortcut changes modify the undo shortcut while it is being used. Native text undo still works while editing flagged-word text.

### 7. Keep behavior boundaries explicit

1. Keyboard undo/redo is global only when focus is not in a native editable target. This is intentional: Ctrl+Z/Cmd+Z inside a text field should edit text, not mutate finance data.
2. Undo/redo restores persisted records and refetches derived views; it does not restore sort order, filters, selected rows, focused rows, modal open state, or scroll position.
3. A new successful action always clears the redo stack.
4. Opaque AI chat finance changes and external provider link/sync/disconnect actions are not undoable in this plan. To include them later, the backend must expose per-action before/after snapshots or a server-side action journal; do not guess inverses from the frontend’s broad invalidations.

## Critical files & anchors

- `src/features/shortcuts/commands.ts` — `CommandId`, `CommandDefinition`, `command(...)`, and `DEFAULT_COMMANDS` define shortcut ids/default bindings; undo/redo aliases require plural defaults.
- `src/features/shortcuts/ShortcutProvider.tsx` — document keydown dispatch, scope filtering, editable-target behavior, conflict detection, and provider API implementation.
- `src/pages/TransactionHistoryPage.tsx` — owns transaction edit/delete/bulk handlers and has access to the visible `transactions` snapshots needed before mutation.
- `src/components/features/MultiTransactionTable.tsx` — owns add-transaction draft state, parse/AI local transforms, and bulk-create save flow.
- `server/services/transactions.ts` — transaction create/update/delete/bulk logic and the model for new restore endpoints; account/category/subcategory/tag services should follow the same soft-restore pattern.

## Verification

Run from `C:/Users/joesa/Code/localfin-ai`.

1. Frontend shortcut/unit tests:
   - Add `src/features/shortcuts/normalize.test.ts` covering exact normalized keys:
     - Ctrl+Z -> `{ key: "Ctrl+Z" }`.
     - Meta+Z -> `{ key: "Meta+Z" }`.
     - Ctrl+Shift+Z -> `{ key: "Ctrl+Shift+Z" }`.
     - Meta+Shift+Z -> `{ key: "Shift+Meta+Z" }`.
     - Ctrl+Y -> `{ key: "Ctrl+Y" }`.
     - `parseShortcut("Cmd+Shift+Z")` -> `{ key: "Shift+Meta+Z" }`.
   - Add `src/features/shortcuts/commands.test.ts` proving `global.undo` includes `Ctrl+Z` and `Meta+Z`, `global.redo` includes `Ctrl+Shift+Z`, `Ctrl+Y`, and `Shift+Meta+Z`, and command ids remain unique.
   - Add `src/features/undo-redo/history.test.ts` proving execute pushes undo, undo moves to redo, redo moves back, new execute clears redo, and rejected apply/undo/redo leaves stacks unchanged.
   - Command: `npm run test:frontend`.
2. Server restore tests:
   - Extend `server/core-invariants.test.ts` or add a focused server test file using the existing `useTempDatabase` pattern.
   - Cover transaction delete -> restore returns the same id and tags; bulk transaction create -> delete -> bulk restore preserves ids.
   - Cover account/category/subcategory/tag delete -> restore preserves the same id; tag restore also restores visibility on a previously tagged transaction because `transaction_tags` rows were retained.
   - Cover restore conflict: delete a tag/account/category, create a new active entity with the same unique key, then restoring the deleted one returns a 400/error and leaves it deleted.
   - Command: `npm test`.
3. Type/lint/build checks:
   - `npm run typecheck`.
   - `npm run lint`.
4. Manual browser smoke test with dev server:
   - Start with `.env` containing the normal `OPENROUTER_API_KEY` if the dev script requires it; run `npm run dev`.
   - In Transaction History, edit a transaction name outside any focused text field, press Ctrl+Z: the old name returns after queries refetch. Press Ctrl+Shift+Z and Ctrl+Y: the edited name returns both times. On macOS-equivalent testing, dispatch/press Cmd+Z and Cmd+Shift+Z and observe the same behavior.
   - In Transaction History, bulk edit two selected transactions’ tags or kind, press Ctrl+Z once: both rows return to their prior values. Press redo: both rows return to the bulk-edited values.
   - In Add Transactions, use Parse Statement or paste a grid block, click outside inputs, press Ctrl+Z: the previous rows return. Redo restores the parsed/pasted rows.
   - In Setup, create then undo/redo an account/category/subcategory/tag and verify the same id is restored by observing dependent transaction/category relationships still resolve after redo.
   - Focus a transaction name input or flagged-words textarea, type text, press Ctrl+Z: only the text edit is undone; no app-level finance action runs.

## Assumptions & contingencies

- The related keyboard additions are included exactly as selected: Ctrl+Y redo and macOS Cmd equivalents. No visible undo/redo buttons and no routine success/no-op notifications are added.
- “Throughout the whole application” is implemented for LocalFin-controlled finance and data-entry actions. Native text editing remains native. External provider workflows and opaque AI chat mutations are excluded because current frontend results do not expose enough before/after data for a safe inverse.
- If a restore endpoint fails because another active entity now uses the same unique key, keep the undo/redo stack unchanged, refetch through existing invalidations, and show the failure error. Do not auto-rename restored entities.
- If a snapshot target is not present in the current page data when a handler runs, execute the current mutation without adding an undo action; do not fetch hidden rows just to create undo history because filters may intentionally hide them.
