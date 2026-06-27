## Context

Implement a first-class transaction tag system for LocalFin AI. User decisions are fixed: transactions support multiple tags; tags are generic with a `type`; tags can be created/assigned inline anywhere transactions are entered or edited plus managed in Settings; dashboard/history include tag filters plus summary reporting; natural-language parsing assigns/creates tags only when the user explicitly names one.

## Approach

### 1. Add the tag data model and shared TypeScript types

1. In `server/db/schema.sql`, add these tables after `subcategories` and before `transactions`:
   - `tags`:
     ```sql
     CREATE TABLE IF NOT EXISTS tags (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       type TEXT NOT NULL DEFAULT 'custom' CHECK(type IN ('custom', 'trip', 'event', 'person', 'reimbursable', 'tax')),
       color TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT,
       deleted_at TEXT
     );
     CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_type ON tags(lower(trim(name)), type) WHERE deleted_at IS NULL;
     CREATE INDEX IF NOT EXISTS idx_tags_type ON tags(type) WHERE deleted_at IS NULL;
     ```
   - `transaction_tags`:
     ```sql
     CREATE TABLE IF NOT EXISTS transaction_tags (
       transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
       tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       PRIMARY KEY (transaction_id, tag_id)
     );
     CREATE INDEX IF NOT EXISTS idx_transaction_tags_tag ON transaction_tags(tag_id);
     CREATE INDEX IF NOT EXISTS idx_transaction_tags_transaction ON transaction_tags(transaction_id);
     ```
2. In `server/db/index.ts`, add `ensureTagTables(database: Database.Database): void` that executes the same `CREATE TABLE IF NOT EXISTS` and index SQL, then call it from `migrate(database)` before `ensureSuspectScanTables(database)`. This keeps existing `data/budget.db` files compatible even though `schema.sql` is already executed on startup.
3. In `src/types/index.ts`, add:

   ```ts
   export type TagType =
     | "custom"
     | "trip"
     | "event"
     | "person"
     | "reimbursable"
     | "tax";

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
   ```

4. Extend existing transaction and dashboard types in `src/types/index.ts`:
   - `TransactionWithDetails` gets `tags: Tag[]`.
   - `TransactionFilters` gets `tagIds?: string[]`.
   - `CreateTransactionData` gets `tag_ids?: string[]`.
   - Add:

     ```ts
     export interface UpdateTransactionData extends Partial<CreateTransactionData> {
       tag_ids?: string[];
     }

     export interface BulkTransactionUpdateData {
       kind?: TransactionKind;
       subcategory_id?: string | null;
       add_tag_ids?: string[];
       remove_tag_ids?: string[];
     }

     export interface TagCategorySummary {
       category_id: string | null;
       category_name: string | null;
       category_type: CategoryType | null;
       category_color: string | null;
       expense_total: number;
       income_total: number;
       net_total: number;
       transaction_count: number;
     }

     export interface TagSummary {
       tag_id: string;
       tag_name: string;
       tag_type: TagType;
       tag_color: string | null;
       expense_total: number;
       income_total: number;
       net_total: number;
       transaction_count: number;
       categories: TagCategorySummary[];
     }
     ```

5. The `TagType` literals are fixed for this implementation: `custom`, `trip`, `event`, `person`, `reimbursable`, `tax`. Do not add a user-editable tag type table.

### 2. Add backend tag CRUD and transaction-tag helpers

1. Create `server/services/tags.ts` by copying the structure of `server/services/categories.ts`: row interface, `rowToTag`, create/list/update/delete functions, soft deletes, and color handling.
2. Export these exact service functions:
   ```ts
   export function createTag(data: {
     name: string;
     type?: TagType;
     color?: string | null;
   }): Tag;
   export function getTags(): Tag[];
   export function getTagById(id: string): Tag | undefined;
   export function updateTag(
     id: string,
     updates: { name?: string; type?: TagType; color?: string | null },
   ): Tag;
   export function deleteTag(id: string): void;
   export function assertActiveTags(tagIds: string[]): string[];
   export function getTagsForTransactions(
     transactionIds: string[],
   ): Map<string, Tag[]>;
   export function replaceTransactionTags(
     transactionId: string,
     tagIds: string[],
   ): void;
   export function addTransactionTags(
     transactionId: string,
     tagIds: string[],
   ): void;
   export function removeTransactionTags(
     transactionId: string,
     tagIds: string[],
   ): void;
   export function resolveOrCreateTagsByName(
     items: Array<{ name: string; type?: TagType }>,
   ): Tag[];
   ```
3. Normalize tag names in the tag service before writing or comparing: `name.trim().replace(/\s+/g, ' ')`. Reject an empty normalized name with `Tag name is required`.
4. Enforce active tag uniqueness case-insensitively by `lower(trim(name))` plus `type`. If a duplicate active tag exists on create or update, throw `A tag with the name "${name}" and type "${type}" already exists`.
5. `assertActiveTags` must de-duplicate IDs while preserving first occurrence order and throw `Tag with id "${id}" not found` for any inactive/missing ID.
6. `deleteTag` soft-deletes the tag and hard-deletes rows from `transaction_tags` for that tag in the same `db.transaction`. Deleted tags must not appear on existing transaction details.
7. `resolveOrCreateTagsByName` resolves by normalized name plus type, defaulting missing type to `custom`; if absent, it creates the tag. It is used only for explicit AI tag requests, not for UI reads.

### 3. Add tag routes and frontend data hook

1. Create `server/routes/tags.ts` following `server/routes/categories.ts`:
   - `GET /` -> `getTags()`.
   - `POST /` validates `{ name: nonEmptyString, type?: tagTypeSchema, color?: colorSchema }`, calls `createTag`, returns status `201`.
   - `PUT /:id` validates at least one of `name`, `type`, `color`, calls `updateTag`.
   - `DELETE /:id` calls `deleteTag`.
   - Use `const tagTypeSchema = z.enum(['custom', 'trip', 'event', 'person', 'reimbursable', 'tax']);`.
   - Use the same `colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable()` pattern as category routes.
2. In `server/config/app.ts`, add `tags: "/api/tags"` to `API_ROUTES`.
3. In `server/index.ts`, import `tagRouter` and mount `app.use(API_ROUTES.tags, tagRouter)` beside the category/subcategory routers.
4. In `src/lib/queryKeys.ts`, add:
   ```ts
   tags: {
     all: ['tags'] as const,
     list: () => [...queryKeys.tags.all, 'list'] as const,
   },
   ```
5. Create `src/hooks/useTags.ts` mirroring `useCategories`:
   - `useQuery` key `queryKeys.tags.list()`, `apiGet<Tag[]>('/tags')`, `select: (res) => res.data ?? []`, `staleTime: Infinity`.
   - mutations `createTag`, `updateTag`, `deleteTag`.
   - invalidation includes `queryKeys.tags.all`, `queryKeys.transactions.all`, and `queryKeys.dashboard.all`.
6. Update `src/hooks/useAI.ts` `invalidateFinanceData` to invalidate `queryKeys.tags.all`.

### 4. Thread tags through transaction CRUD, filters, and search

1. In `server/services/transactions.ts`:
   - Import `Tag`, helper functions from `server/services/tags.ts`, and `CreateTransactionData`, `UpdateTransactionData`, `BulkTransactionUpdateData` from shared types.
   - Remove or rename the local `UpdateTransactionData` interface so the shared type is the single source of truth.
   - Add `tags: Tag[]` in `rowToTransactionWithDetails`; load tags with `getTagsForTransactions`.
   - Set these exported signatures exactly:
     ```ts
     export function createTransaction(
       data: CreateTransactionData,
     ): TransactionWithDetails;
     export function getTransactionsWithDetails(
       filters?: TransactionFilters,
     ): TransactionWithDetails[];
     export function getTransactionById(
       id: string,
     ): TransactionWithDetails | null;
     export function updateTransaction(
       id: string,
       updates: UpdateTransactionData,
     ): TransactionWithDetails | null;
     export function bulkUpdateTransactions(
       ids: string[],
       updates: BulkTransactionUpdateData,
     ): void;
     export function bulkCreateTransactions(
       transactions: CreateTransactionData[],
     ): TransactionWithDetails[];
     ```
2. Update `getTransactionsWithDetails(filters)`:
   - Keep the current account/subcategory/category joins as-is.
   - Do not join `transaction_tags` directly into the main select; that would duplicate transaction rows.
   - After loading rows, call `getTagsForTransactions(rows.map((row) => row.id))` and attach `tags: tagMap.get(row.id) ?? []`.
   - Add `filters.tagIds` support in `buildWhereClause` with OR semantics: a transaction matches if it has at least one selected active tag.
     ```sql
     EXISTS (
       SELECT 1
       FROM transaction_tags filter_tt
       JOIN tags filter_tag ON filter_tag.id = filter_tt.tag_id AND filter_tag.deleted_at IS NULL
       WHERE filter_tt.transaction_id = t.id
         AND filter_tt.tag_id IN (?, ...)
     )
     ```
3. Update `getTransactionById(id)` to attach `tags` with `getTagsForTransactions([id])`.
4. Update `createTransaction(data)`:
   - Validate `data.tag_ids ?? []` with `assertActiveTags`.
   - Wrap insert and `replaceTransactionTags(id, tagIds)` in one `db.transaction`.
   - Return `getTransactionById(id)` so the route returns `TransactionWithDetails` including tags; do not return a tag-less base transaction.
5. Update `updateTransaction(id, updates)`:
   - Existing field updates stay unchanged.
   - If `updates.tag_ids !== undefined`, validate and replace the full tag set for that transaction.
   - Replacement semantics are only for single-transaction edit flows.
   - Return `getTransactionById(id)`.
6. Update `bulkUpdateTransactions(ids, updates)`:
   - Keep existing kind/subcategory behavior.
   - Add `add_tag_ids?: string[]` and `remove_tag_ids?: string[]`.
   - Validate both arrays with `assertActiveTags`.
   - If the same tag ID appears in both arrays, throw `Cannot add and remove the same tag in one bulk update`.
   - For each selected transaction, add and remove the requested tags without replacing unrelated tags.
   - Reject a bulk update with no kind/subcategory/tag changes using the existing “At least one update field is required” style.
7. Update `bulkCreateTransactions(transactions)` so each row can include `tag_ids`; each created transaction receives its own tags.
8. Update `checkDuplicates` and transfer matching only if TypeScript requires signature changes; tags do not participate in duplicate detection.
9. In `server/routes/transactions.ts`:
   - Extend `transactionFiltersSchema` with `tagIds: optionalQueryStringArray`.
   - Extend `createTransactionSchema` with `tag_ids: z.array(nonEmptyString).max(50).optional()`.
   - Extend `updateTransactionSchema` with `tag_ids: z.array(nonEmptyString).max(50).optional()`.
   - Extend bulk update `updates` with `add_tag_ids` and `remove_tag_ids`, both `z.array(nonEmptyString).max(50).optional()`.
   - Keep `bulkCreateSchema` using `createTransactionSchema`.
10. In `server/services/transaction-search.ts`:
    - Add `tag` and `tags` to `FIELD_ALIASES`.
    - Add `"tag"` to `SearchField`.
    - Compile `tag:<value>` using an `EXISTS` subquery against `transaction_tags` and active `tags`, comparing `tags.name` with the existing `compileTextField`/LIKE semantics.
    - Add tag names to generic term search through an OR `EXISTS` clause. This lets `Cabo` find a transaction tagged `Cabo Trip`.
    - Preserve existing SQL-escape behavior by reusing `likePattern`.

### 5. Add dashboard tag filters and tag summary reporting

1. In `server/routes/dashboard.ts`, replace the date-only query schema with a reusable schema that also accepts `tagIds` using the same preprocess logic as `server/routes/transactions.ts`.
2. Apply `tagIds` to transaction-based dashboard endpoints only:
   - `/api/dashboard/category-summary`
   - `/api/dashboard/metrics`
   - `/api/dashboard/charts/sankey`
   - new `/api/dashboard/tag-summary`
3. Do not apply tag filters to `/api/dashboard/account-summary` or `/api/dashboard/charts/net-worth`; those are balance reports and a tag-filtered running balance/net worth chart would be misleading.
4. In `server/services/dashboard.ts`, add a small helper that returns an `EXISTS` tag-filter clause and params for optional `tagIds`, then use it in `getCategorySummary` and `getDashboardMetrics`.
5. Add `getTagSummary(startDate: string, endDate: string, tagIds?: string[]): TagSummary[]` in `server/services/dashboard.ts`:
   - Include only active tags and active transactions in the date range.
   - If `tagIds` is present, include only those selected tags.
   - `expense_total` is positive spend: sum `ABS(t.amount)` where `t.kind = 'expense'`.
   - `income_total` is positive income: sum `t.amount` where `t.kind = 'income'`.
   - `net_total` is the signed sum of all tagged transaction amounts.
   - `transaction_count` counts distinct tagged transactions.
   - Include `categories` breakdown using the same totals/counts grouped by category; uncategorized rows use `category_id: null`, `category_name: null`, `category_type: null`, `category_color: null`.
6. In `server/services/charts.ts`, update `prepareSankeyData(startDate, endDate, tagIds?: string[])` so income and expense SQL queries include the same optional tag `EXISTS` filter.
7. In `server/routes/dashboard.ts`, add:
   ```ts
   router.get('/tag-summary', ...)
   ```
   returning `getTagSummary(query.startDate, query.endDate, query.tagIds)`.
8. In `src/hooks/useDashboard.ts`, change the signature to:
   ```ts
   export function useDashboard(
     startDate: string,
     endDate: string,
     filters?: { tagIds?: string[] },
   );
   ```
   Build query strings with repeated `tagIds` params. Include `tagIds` in query keys for category summary, metrics, sankey, and tag summary. Leave account summary/net-worth query keys date-only.
9. Extend `src/lib/queryKeys.ts` dashboard keys to accept optional filter objects for transaction-based reports and add `tagSummary(startDate, endDate, filters?)`.
10. Add `TagSummaryTable` in `src/components/features/TagSummary.tsx`, copying the expandable pattern from `CategorySummaryTable`. Top-level rows display tag color/name/type, spend, income, net, count; expanded rows display category breakdown.
11. In `src/pages/DashboardPage.tsx`:
    - Load tags with `useTags()`.
    - Add `const [tagIds, setTagIds] = useState<string[]>([])`.
    - Add a `MultiSelect` near the date filters with `allLabel="All Tags"` and `selectedLabel="tags"`.
    - Pass `{ tagIds: tagIds.length > 0 ? tagIds : undefined }` to `useDashboard`.
    - Render `Tag Summary` card above `Category Summary`.
    - Add helper text near the tag filter: `Filters spend/income summaries, category summary, tag summary, and money flow. Account balances and net worth stay unfiltered.`

### 6. Add reusable tag UI and settings management

1. Create `src/components/features/TagPicker.tsx`.
2. `TagPicker` must support:
   - Multi-selecting existing tags.
   - Showing selected tags as compact colored chips using `resolveEntityColor`.
   - Inline creation by name.
   - Selecting the new tag type from `custom`, `trip`, `event`, `person`, `reimbursable`, `tax`.
   - Optional `className`, `disabled`, and `placeholder`.
3. `TagPicker` props:
   ```ts
   interface TagPickerProps {
     value: string[];
     onChange: (tagIds: string[]) => void;
     tags: Tag[];
     onCreateTag: (data: CreateTagData) => Promise<Tag>;
     className?: string;
     disabled?: boolean;
     placeholder?: string;
   }
   ```
4. Creation behavior:
   - Normalize the typed name with `trim().replace(/\s+/g, ' ')`.
   - If the normalized name is empty, do nothing.
   - If an existing active tag with same normalized name and selected type exists, select it instead of creating.
   - Otherwise call `onCreateTag({ name, type })`, then append the returned tag ID to `value`.
   - If create fails, parent pages must catch the rejected promise and toast the thrown error message.
5. Create `src/components/features/TagManager.tsx` for Settings:
   - Call `useTags()` directly inside `TagManager`; `SettingsPage` only renders `<TagManager />`.
   - List all active tags sorted by `type`, then `name`.
   - Each row allows editing name, type, color, saving via `updateTag`, and deleting via `deleteTag`.
   - Add a create row with name input, type select, `ColorPicker`, and Create button.
   - Use `toast.success`/`toast.error` for create/update/delete feedback, matching `SetupPage.tsx`; do not add inline status messages for tag CRUD.
6. In `src/pages/SettingsPage.tsx`, render the tag manager in a new card titled `Tags` near the existing finance-related settings. Keep the settings route path `/settings`.

### 7. Add tags to transaction input, history, inline edit, and bulk edit

1. In `src/components/features/MultiTransactionTable.tsx`:
   - Add `tag_ids: string[]` to `TransactionRow`.
   - Add a `Tags` column between `Subcategory` and `Comment`.
   - Load tags and `createTag` using `useTags()`.
   - Render `TagPicker` in each row.
   - Add `tag_ids: r.tag_ids` to the `CreateTransactionData` payload in `handleSave`.
   - Update paste/grid indexing from 7 fields per row to 8 fields per row.
   - Add optional paste support for existing tags: comma-separated tag names/IDs in the Tags column select matching active tags; unknown pasted tag names are ignored rather than auto-created.
2. In `src/pages/TransactionHistoryPage.tsx`:
   - Load tags with `useTags()`.
   - Add `tagIds` filter state.
   - Add a tag `MultiSelect` beside the subcategory filter.
   - Include `tagIds: tagIds.length > 0 ? tagIds : undefined` in `applyFilters` and `applyDateRangePreset`.
   - Pass `tags` and an async `onCreateTag` wrapper to `TransactionTable` and `BulkEditModal`.
3. In `src/components/features/TransactionTable.tsx`:
   - Extend `EditState` with `tag_ids: string[]`.
   - Add a `Tags` column after `Subcategory`.
   - In read mode, render tag chips from `t.tags`.
   - In edit mode, render `TagPicker`.
   - In `saveEdit`, include `tag_ids: editState.tag_ids`; this replaces the transaction’s full tag set.
   - Keep existing subcategory paste behavior unchanged.
4. In `src/components/features/BulkEditModal.tsx`:
   - Extend `onConfirm` type to `{ kind?: TransactionKind; subcategory_id?: string | null; add_tag_ids?: string[]; remove_tag_ids?: string[] }`.
   - Add two `TagPicker` controls: `Add tags` and `Remove tags`.
   - If the same tag is selected in both controls, disable Confirm and show `A tag cannot be both added and removed.`
   - Confirm is enabled if kind/subcategory/add/remove has at least one change.
   - Bulk tag edits add/remove tags and do not replace unrelated tags.
5. In `src/hooks/useTransactions.ts`, update mutation types to use shared `UpdateTransactionData` and `BulkTransactionUpdateData`; query string building already supports arrays and will send repeated `tagIds` params.

### 8. Add explicit-only tag support to assistant actions

1. In `src/types/index.ts`, `server/services/ai-chat/types.ts`, and `server/services/ai-chat/prompting.ts`, add tags to `PlanningContext` and `AssistantContext`.
2. In `server/services/ai-chat/prompting.ts`:
   - `compactContext()` includes active tags as `{ id, name, type }`.
   - `planningContext()` includes active tags.
   - Update `assistantSystemMessage()` allowed actions:
     ```text
     - create_tag: { name, type?: "custom"|"trip"|"event"|"person"|"reimbursable"|"tax" }
     - update_tag: { id? or current_name, name?, type?, color? }
     - create_transaction: { ..., tag_ids?: string[], tag_names?: string[], tags?: [{ name, type? }] }
     - search_transactions: { ..., tag_id? or tag_name?, tagIds?, ... }
     - update_transaction: { ..., tag_ids?: string[], tag_names?: string[], tags?: [{ name, type? }] }
     - bulk_update_transactions: { ..., tag_id? or tag_name?, updates: { ..., add_tag_ids?: string[], remove_tag_ids?: string[], add_tag_names?: string[], remove_tag_names?: string[] } }
     ```
   - Add an explicit-only rule: `Only assign/create tags when the user explicitly uses words like tag, tags, trip, event, project, "for <name> trip", "tag it as <name>", or "add/remove tag <name>". Do not infer tags from merchant names, locations, categories, or subcategories.`
   - Add search grammar text for `tag:`/`tags:`.
3. In `server/services/ai-chat/input-validators.ts`, add:
   ```ts
   export function requireTagType(value: unknown, actionType: string): TagType;
   export function optionalTagType(
     value: unknown,
     actionType: string,
   ): TagType | undefined;
   ```
   and helper(s) to normalize string arrays from `tag_names`, `add_tag_names`, and `remove_tag_names`.
4. In `server/services/ai-chat/entity-resolution.ts`, add tag resolvers mirroring subcategory resolution:
   ```ts
   export function resolveTag(
     input: Record<string, unknown>,
     tags: Tag[],
   ): string | undefined;
   export function resolveRequestedTag(
     input: Record<string, unknown>,
     tags: Tag[],
     actionType: string,
   ): string | undefined;
   export function resolveRequestedTags(
     input: Record<string, unknown>,
     tags: Tag[],
     actionType: string,
   ): string[];
   ```
   Ambiguous errors include tag type in candidates using `describeEntityCandidate`.
5. In `server/services/ai-chat/action-preparation.ts`:
   - Extend `transactionSearchFilters` to accept tag refs and output `tagIds`.
   - Extend `transactionUpdateInput` to return `add_tag_ids`, `remove_tag_ids`, or `tag_ids` when provided by the model.
   - Add explicit text helpers only for direct tag commands, e.g. `tag it as`, `add tag`, `remove tag`, `for <name> trip`; do not derive tags from transaction names or categories.
   - Add tag names to `promptAnchorsForAction` so search-before-update repair still anchors described updates.
6. In `server/services/ai-chat/action-executor.ts`:
   - Import tag services.
   - Load `const tags = getTags()` with accounts/categories/subcategories.
   - Add `create_tag` and `update_tag` cases.
   - In `create_transaction`, resolve `tag_ids`, `tag_names`, and `tags` objects. Existing tags are used; missing explicit tag names are created with default type `custom` unless the object provides `type` or the user/model type is `trip`.
   - In `search_transactions`, include `tags: transaction.tags.map(({ id, name, type }) => ({ id, name, type }))` in results.
   - In `update_transaction`, support full replacement via `tag_ids`/`tag_names`/`tags`.
   - In `bulk_update_transactions`, support add/remove tag IDs/names and route to the bulk service fields.
7. Do not change `server/services/ai.ts` transaction categorization to infer tags; AI Categorize remains category/subcategory-only.
8. Do not change `server/services/parser.ts` statement parsing to infer tags from statement lines. Statement-import tags are assigned manually in the input grid through `TagPicker`.

### 9. Update tests

1. Extend `server/core-invariants.test.ts` imports with tag service and dashboard summary functions.
2. Add a test `transaction tags create, read, replace, filter, search, and delete cleanly`:
   - Create Checking, Food/Groceries, tags `Cabo Trip` type `trip` and `Reimbursable` type `reimbursable`.
   - Create one transaction with both tags and one transaction without tags.
   - Assert `getTransactionsWithDetails({ tagIds: [cabo.id] })` returns only the tagged transaction and `transaction.tags.map(t => t.name)` includes both names.
   - Assert `getTransactionsWithDetails({ searchQuery: 'tag:"Cabo Trip"' })` returns the tagged transaction.
   - Update the transaction with `tag_ids: [reimbursable.id]` and assert Cabo no longer matches.
   - Delete `Reimbursable` and assert the transaction returns `tags: []`.
3. Add a test `bulk tag edits add and remove without replacing unrelated tags`:
   - Create two transactions with distinct starting tags.
   - Call `bulkUpdateTransactions(ids, { add_tag_ids: [cabo.id], remove_tag_ids: [old.id] })`.
   - Assert Cabo was added to both, old was removed, and unrelated tags remain.
4. Add a test `tag summary reports spend, income, net, and category breakdown`:
   - Create a `trip` tag, expense and income transactions with that tag, and an untagged control transaction in the same date range.
   - Assert `getTagSummary(start, end)` includes only tagged rows in totals.
   - Assert `expense_total` is positive absolute spend, `income_total` is positive income, and `net_total` is the signed sum.
5. Extend `server/core-invariants.test.ts` search escaping coverage with `tag:"100%"` to prove tag LIKE metacharacters are literal.
6. Extend `server/agent-system.test.ts` with `agent creates an explicit trip tag and assigns it to a transaction`:
   - Mock OpenRouter to return `create_transaction` with `tags: [{ name: "Cabo Trip", type: "trip" }]` or `tag_names: ["Cabo Trip"]`.
   - Message includes explicit wording such as `tag it as Cabo Trip`.
   - Assert one tag row exists with `type = 'trip'`, the transaction details include that tag, and actions succeed.
7. Extend `server/agent-system.test.ts` with `agent does not infer tags without explicit tag wording`:
   - Mock response should not include tag fields when the user says only `hotel in Cabo`.
   - Assert transaction saves with `tags: []`.
   - This verifies the prompt/test contract; executor cannot prevent a malicious model from sending tag fields, but the tool-loop prompt must not request inferred tags.
8. If frontend tests are desired, first add a frontend test runner; no such runner exists in `package.json`. For this implementation, rely on TypeScript, lint, server integration tests, and manual UI verification.

## Critical files & anchors

- `server/db/schema.sql` — add normalized `tags` and `transaction_tags` tables beside `categories`/`transactions`; existing `transactions` currently has only `subcategory_id` and `comment`.
- `server/services/transactions.ts` — extend `buildWhereClause`, `createTransaction`, `getTransactionsWithDetails`, `getTransactionById`, `updateTransaction`, `bulkUpdateTransactions`, and `bulkCreateTransactions` so tags are persisted and returned without duplicating transaction rows.
- `server/services/ai-chat/prompting.ts` — update assistant context and action contract; this is the source of the explicit-only AI tag policy.
- `src/components/features/MultiTransactionTable.tsx` — add inline tag selection/creation to the input grid and include `tag_ids` in create payloads; update the spreadsheet-like cell indexing.
- `src/pages/SetupPage.tsx` — copy its collapsible CRUD-management patterns for `TagManager`; do not copy `SettingsPage` keyboard-shortcut internals for tag CRUD.

## Verification

Run from `C:/Users/joesa/Code/localfin-ai`.

1. Server behavior and AI/tool-loop tests:
   ```bash
   npm test
   ```
   Expected: all `server/**/*.test.ts` tests pass, including the new tag CRUD/filter/search/summary tests and explicit-only AI tag tests.
2. Type safety:
   ```bash
   npm run typecheck
   ```
   Expected: no TypeScript errors across the server and Vite app references.
3. Lint:
   ```bash
   npm run lint
   ```
   Expected: no ESLint errors and no inline disables added for this feature.
4. Manual UI smoke, with a normal project `.env` present and the dev server running:
   ```bash
   npm run dev
   ```
   Then in the browser:
   - Go to `/setup`. Ensure there is an asset account named `Checking`, an expense category `Wants`, and a subcategory `Travel`.
   - Go to `/transactions/input`.
   - Add `2026-06-01`, name `Cabo Hotel`, amount `1000`, type `expense`, account `Checking`, subcategory `Wants > Travel`, and create/select tag `Cabo Trip` with type `trip`. Save All.
   - Add a second transaction in the same date range named `Local Hotel`, amount `200`, type `expense`, same account/subcategory, with no tags. Save All.
   - Go to `/transactions/history`, set the date range to include `2026-06-01`, select tag `Cabo Trip`, and Apply. Expected: only `Cabo Hotel` is listed; the row shows a `Cabo Trip` chip.
   - Edit `Cabo Hotel` in history, remove `Cabo Trip`, save, reapply the same tag filter. Expected: no transactions are listed.
   - Add `Cabo Trip` back through inline edit. Select both transactions, open Bulk Edit, add tag `Reimbursable`, confirm. Expected: both rows show `Reimbursable`, and `Cabo Hotel` still shows `Cabo Trip`.
   - Go to `/dashboard`, set the date range to include `2026-06-01`, select tag `Cabo Trip`. Expected: Tag Summary shows `Cabo Trip` with `expense_total` `$1,000.00`; Category Summary and Money Flow include only `Cabo Hotel` for transaction-based summaries; Account Summary and Net Worth remain unfiltered as stated by the helper text.
   - Go to `/settings`, edit the `Cabo Trip` color/name in the Tags card, return to history. Expected: tag chips reflect the updated name/color.

## Assumptions & contingencies

- Tag cardinality is many-to-many: a transaction may have zero, one, or many tags. Do not implement a `transactions.tag_id` column.
- Tag types are fixed literals: `custom`, `trip`, `event`, `person`, `reimbursable`, `tax`. If a caller omits type, use `custom`; if AI sees explicit wording `trip`, use `trip`.
- Transaction filter `tagIds` uses OR semantics: selecting Cabo and Reimbursable returns transactions that have either tag. Users can require multiple tags through search syntax, e.g. `tag:"Cabo Trip" AND tag:Reimbursable`.
- Single-transaction edits replace the full tag set with `tag_ids`; bulk edits only add/remove tags and never replace unrelated existing tags.
- Dashboard tag filtering intentionally excludes Account Summary and Net Worth. If a user expects every dashboard card to filter, keep this implementation anyway and rely on the helper text because tag-filtered balances are misleading.
- AI behavior is explicit-only. The executor may honor tag fields sent by the model, but prompts/tests must ensure the model only sends them when the user explicitly mentions tags/trips/events/projects.
- Existing statement parsing and AI categorization remain category/subcategory-only. Tags from imported statements are assigned manually in the grid after parsing.
- There is no frontend test runner in the current package setup. Do not add one for this task unless implementation creates complex pure UI logic that cannot be covered by typecheck/manual smoke; if that happens, add Vitest + React Testing Library in a separate explicit setup step before writing component tests.
