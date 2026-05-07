# Keyboard Shortcuts System

## 1. Create The Implementation Branch

Create branch `feature/keyboard-shortcuts-system` from `main` in a `plan-worktree` checkout before implementing this plan.

## Summary

Add a first-class, editable keyboard shortcuts system for LocalFin AI. Every user-facing action should be represented by a command in a central registry, have a keyboard shortcut association, expose that shortcut in the UI, and be editable from a dedicated Keyboard Shortcuts section in Settings.

The implementation should treat shortcuts as a productivity layer over an already keyboard-accessible app, not as the only way to use the app. Native tab order, Enter/Space activation, Escape dismissal, and form submission behavior must keep working.

## Research Notes

- W3C WCAG 2.1.4 requires single-character shortcuts to be removable, remappable, or active only when the relevant component has focus. Source: https://www.w3.org/WAI/WCAG21/Understanding/character-key-shortcuts.html
- WAI-ARIA APG emphasizes that keyboard interfaces should be discoverable and should use familiar platform/widget patterns where possible. Source: https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- MDN recommends avoiding browser, operating system, and assistive technology shortcut conflicts, and using `aria-keyshortcuts` only as documentation for implemented shortcuts. Source: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-keyshortcuts
- Microsoft Windows UX guidance says shortcuts should be memorable, use first or memorable command letters where possible, and be documented in menu/tooltips plus a single shortcut reference. Source: https://learn.microsoft.com/en-us/windows/win32/uxguide/inter-keyboard
- Apple HIG recommends using platform conventions for modifier keys and avoiding shortcuts that conflict with system conventions. Source: https://developer.apple.com/design/human-interface-guidelines/keyboards

## Design Principles

- Every user action maps to a `CommandDefinition`.
- Every command has a default shortcut, an editable user shortcut, or a deliberately disabled shortcut state that is visible and editable. For this project, prefer active defaults for every command unless conflict testing proves a default is unreliable in browsers.
- No global single-letter defaults. Single-key bindings may be allowed only inside focused composite widgets such as tables and only if users can disable or remap them.
- Do not override browser or OS standards such as `Ctrl+R`, `Ctrl+L`, `Ctrl+T`, `Ctrl+W`, `Ctrl+P`, `Ctrl+F`, `Ctrl+S`, `Alt+Left`, `Alt+Right`, `F5`, or common screen-reader-reserved patterns.
- Scope commands by context so the same memorable binding can mean the same action in different places, or be blocked if a more specific scope owns it.
- Never fire global shortcuts while focus is inside text inputs, textareas, selects, contenteditable elements, date inputs, number inputs, or native dialog controls unless the command is explicitly marked `inputSafe`.
- Prefer `Ctrl+Alt+<mnemonic>` on Windows/Linux and `Meta+Alt+<mnemonic>` on macOS for global app commands. Render platform labels as `Ctrl Alt D` vs `⌘ Option D`, but store normalized keys.
- Use `Enter`, `Ctrl+Enter`, `Escape`, arrow keys, `Space`, `Home`, `End`, and `Delete` for focused table/modal interactions where users expect them.
- Expose shortcuts in button `title`, accessible labels when appropriate, and `aria-keyshortcuts` on actionable controls after bindings are resolved.

## Current App Action Inventory

### Global Layout And Navigation

- Go to Dashboard: `/`
- Go to Setup: `/setup`
- Go to Add Transactions: `/transactions/input`
- Go to Transaction History: `/transactions/history`
- Go to Settings: `/settings`
- Open AI assistant
- Close AI assistant
- Focus assistant input when panel is open
- Send assistant message

### Dashboard

- Apply custom date range
- Apply each date range preset from `dateRangePresets`
- Focus start date
- Focus end date

### Add Transactions

- Add row
- AI categorize filled rows
- Clear all rows
- Save all rows
- Focus first transaction row
- Remove focused row
- Move between editable grid cells
- Paste statement text focus
- Focus statement account select
- Parse statement
- Clear parsed/import state if implemented during cleanup

### Transaction History

- Apply filters
- Focus search
- Focus date/account filters
- Apply each date range preset
- Sort by date, name, amount, balance
- Select all visible transactions
- Toggle focused transaction selection
- Edit focused transaction
- Save focused transaction edit
- Cancel focused transaction edit
- Delete focused transaction
- Bulk edit selected transactions
- Bulk delete selected transactions
- Focus next/previous row
- Focus first/last row
- Paste subcategory into focused transaction/subcategory cell

### Setup

- Toggle Accounts section
- Toggle Categories section
- Toggle Subcategories section
- Sort each section by supported columns
- Add account/category/subcategory
- Save account/category/subcategory add form
- Cancel account/category/subcategory add form
- Edit focused account/category/subcategory
- Save focused account/category/subcategory edit
- Cancel focused account/category/subcategory edit
- Delete focused account/category/subcategory
- Bulk delete selected rows in each setup section
- Select all visible rows in each setup section
- Toggle focused row selection in each setup section

### Modals And Confirmations

- Confirm destructive modal action
- Cancel/close modal
- Close popover/select/dialog when open

### Settings

- Focus Keyboard Shortcuts section
- Search shortcut commands
- Start editing selected shortcut
- Clear selected shortcut
- Reset selected shortcut to default
- Reset all shortcuts to defaults
- Export/import shortcut map only if added as an optional local-backup feature

## Proposed Default Shortcut Map

Use a central map so implementation and Settings render from the same source. Suggested defaults assume Windows/Linux labels; render macOS equivalents dynamically.

### Global Commands

| Command | Default |
| --- | --- |
| Dashboard | `Ctrl+Alt+D` |
| Setup | `Ctrl+Alt+S` |
| Add Transactions | `Ctrl+Alt+A` |
| Transaction History | `Ctrl+Alt+H` |
| Settings | `Ctrl+Alt+,` |
| Keyboard Shortcuts Settings | `Ctrl+Alt+K` |
| Open/close AI assistant | `Ctrl+Alt+I` |
| Focus assistant input | `Ctrl+Alt+.` |
| Close panel/modal/edit mode | `Escape` scoped |

### Dashboard Commands

| Command | Default |
| --- | --- |
| Apply date range | `Ctrl+Enter` scoped |
| Focus start date | `Alt+[` scoped |
| Focus end date | `Alt+]` scoped |
| Presets 1-6 | `Ctrl+Alt+1` through `Ctrl+Alt+6` scoped |

### Add Transactions Commands

| Command | Default |
| --- | --- |
| Add row | `Ctrl+Alt+N` scoped |
| AI categorize | `Ctrl+Alt+G` scoped |
| Clear all rows | `Ctrl+Alt+Backspace` scoped |
| Save all rows | `Ctrl+Enter` scoped |
| Parse statement | `Ctrl+Alt+P` scoped |
| Focus statement text | `Ctrl+Alt+T` scoped |
| Focus transaction grid | `Ctrl+Alt+F` scoped |
| Remove focused row | `Delete` grid-scoped |
| Move across cells | Arrow keys grid-scoped |

### Transaction History Commands

| Command | Default |
| --- | --- |
| Focus search | `/` only when table/page container has focus, plus editable fallback `Ctrl+Alt+F` |
| Apply filters | `Ctrl+Enter` scoped |
| Select all visible | `Ctrl+Alt+X` scoped |
| Toggle focused row | `Space` table-scoped |
| Edit focused row | `Enter` table-scoped |
| Save edit | `Ctrl+Enter` edit-scoped |
| Cancel edit | `Escape` edit-scoped |
| Delete focused row | `Delete` table-scoped |
| Bulk edit | `Ctrl+Alt+E` scoped |
| Bulk delete | `Ctrl+Alt+Backspace` scoped |
| Sort columns | `Alt+1` through `Alt+4` table-scoped |
| Next/previous row | `ArrowDown` / `ArrowUp` table-scoped |
| First/last row | `Home` / `End` table-scoped |

### Setup Commands

| Command | Default |
| --- | --- |
| Toggle Accounts | `Ctrl+Alt+1` scoped |
| Toggle Categories | `Ctrl+Alt+2` scoped |
| Toggle Subcategories | `Ctrl+Alt+3` scoped |
| Add item in focused section | `Ctrl+Alt+N` section-scoped |
| Save add/edit form | `Ctrl+Enter` form-scoped |
| Cancel add/edit form | `Escape` form-scoped |
| Edit focused item | `Enter` table-scoped |
| Delete focused item | `Delete` table-scoped |
| Bulk delete selected | `Ctrl+Alt+Backspace` section-scoped |
| Select all visible | `Ctrl+Alt+X` section-scoped |
| Toggle focused row selection | `Space` table-scoped |
| Sort visible section columns | `Alt+1`, `Alt+2`, `Alt+3` section-scoped |

### Settings Shortcut Editor Commands

| Command | Default |
| --- | --- |
| Focus shortcuts search | `Ctrl+Alt+F` settings-scoped |
| Edit selected shortcut | `Enter` shortcuts-table-scoped |
| Clear selected shortcut | `Delete` shortcuts-table-scoped |
| Reset selected shortcut | `Ctrl+Alt+R` shortcuts-table-scoped |
| Reset all shortcuts | `Ctrl+Alt+Shift+R` settings-scoped |

## Implementation Plan

1. Add `src/features/shortcuts/commands.ts`.
   - Define `CommandId`, `CommandScope`, `ShortcutBinding`, `CommandDefinition`, and `ShortcutMap` types.
   - Define `DEFAULT_COMMANDS` grouped by `global`, `dashboard`, `transactionInput`, `transactionHistory`, `setup`, `settings`, `modal`, `table`, and `form`.
   - Include label, description, category, scope, default binding, `inputSafe`, `preventDefault`, and optional `ariaTargetHint`.

2. Add `src/features/shortcuts/normalize.ts`.
   - Normalize `KeyboardEvent` into canonical strings such as `Ctrl+Alt+D`.
   - Support platform display labels separately from storage.
   - Reject or warn on reserved shortcuts.
   - Treat shifted printable characters consistently, e.g. store `Ctrl+Alt+Comma` or `Ctrl+Alt+,`, but render human-friendly labels.

3. Add `src/features/shortcuts/storage.ts`.
   - Persist user bindings in `localStorage` under a versioned key such as `localfin.shortcuts.v1`.
   - Store only overrides from defaults to reduce migration risk.
   - Include schema version, updated timestamp, and command override entries.
   - Provide import/export-ready pure functions but keep UI for import/export optional unless time allows.

4. Add `src/features/shortcuts/ShortcutProvider.tsx`.
   - Wrap the app in a provider in `src/App.tsx` or `src/Router.tsx`.
   - Maintain the active shortcut map, registered command handlers, and current scope stack.
   - Install one document-level `keydown` listener.
   - Resolve commands by most specific active scope first, then global.
   - Ignore global shortcuts in editable fields unless `inputSafe` is true.
   - Provide APIs:
     - `registerShortcutHandler(commandId, handler, options)`
     - `useShortcut(commandId, handler, options)`
     - `useShortcutScope(scope, enabled)`
     - `getShortcut(commandId)`
     - `setShortcut(commandId, binding | null)`
     - `resetShortcut(commandId)`
     - `resetAllShortcuts()`
     - `getConflicts(binding, scope)`

5. Add `src/features/shortcuts/ShortcutHint.tsx`.
   - Render compact shortcut chips for buttons and nav links.
   - Provide `getAriaKeyShortcuts(commandId)` for controls with actual bindings.
   - Update `Button` only if a small optional `shortcut` prop can be added cleanly; otherwise render hints beside existing labels in feature components.

6. Integrate global navigation and assistant commands.
   - In `AppLayout`, register route navigation commands with `useNavigate`.
   - Register open/close/focus assistant commands.
   - Ensure Escape closes the assistant only when the assistant owns focus or the panel is open and no modal is above it.

7. Integrate Dashboard commands.
   - Register apply date range, focus start/end date, and date range presets.
   - Add refs to date inputs.
   - Render shortcut hints on Apply and preset buttons.

8. Integrate Add Transactions commands.
   - Register toolbar actions in `MultiTransactionTable`.
   - Add refs for statement account, statement textarea, and first grid cell.
   - Add roving focus for the transaction entry grid if practical; otherwise implement command focus targets with standard tab order first and track row focus through focused inputs.
   - Bind `Delete` to remove the focused row only when a row control is focused and not while typing in a text field.

9. Integrate Transaction History commands.
   - Add table focus management to `TransactionTable`: focused row ID, next/previous/first/last row movement, selection toggle, edit, delete, save, cancel.
   - Register filter/search/preset commands in `TransactionHistoryPage`.
   - Register sort commands for the table columns.
   - Render shortcut hints in action bar and row action tooltips.

10. Integrate Setup commands.
    - Add section scope support to `AccountsSection`, `CategoriesSection`, and `SubcategoriesSection`.
    - Register section toggles, add/save/cancel, edit/delete, selection, bulk delete, and sort commands.
    - Ensure system-locked categories cannot be deleted by shortcut and announce a toast or keep command disabled.

11. Integrate modals.
    - Update `ConfirmDeleteModal` and `BulkEditModal` so `Enter`/`Ctrl+Enter` confirms and `Escape` closes through the shared shortcut system or through native dialog handling.
    - Confirm shortcuts must not bypass loading/disabled states.

12. Build the Settings Keyboard Shortcuts section.
    - Extend `SettingsPage` with a dedicated `Keyboard Shortcuts` card or section.
    - Include search/filter by command label, category, route, and current key.
    - Show command label, description, category, default shortcut, current shortcut, conflict status, and reset/clear/edit controls.
    - Implement a capture control: click Edit, press new key combination, validate, show conflicts, then save.
    - Support clearing a shortcut and resetting one or all shortcuts.
    - Provide a "Disable single-key shortcuts" toggle if any single-key scoped defaults remain.
    - Make the editor fully keyboard accessible using standard buttons/inputs, visible focus rings, and live conflict/error text.

13. Add conflict and reserved-key UX.
    - Hard-block browser/system combinations that are known to be unsafe.
    - Warn but allow same binding in disjoint scopes.
    - Block duplicate bindings within the same effective scope unless the user first clears the existing command.
    - Explain conflicts inline in Settings, not only via toast.

14. Add command coverage checks.
    - Add a test or static assertion that every `CommandDefinition` has a default binding or explicit editable disabled state.
    - Add a dev-only coverage list for known action IDs so newly added buttons/actions are not silently omitted.
    - Consider adding `data-command-id` to shortcut-backed controls for future UI/audit tests.

15. Add focused tests.
    - Unit test shortcut normalization and display labels.
    - Unit test reserved-key detection and scope conflict detection.
    - Component test or lightweight integration test for Settings editing behavior if the repo has a browser/component test path by then.
    - Manual browser smoke test for navigation, forms, modals, transaction table row actions, and shortcut editing.

## File-Level Change List

- `src/features/shortcuts/commands.ts`: command registry and defaults.
- `src/features/shortcuts/normalize.ts`: event parsing, display labels, reserved-key logic.
- `src/features/shortcuts/storage.ts`: localStorage persistence and migrations.
- `src/features/shortcuts/ShortcutProvider.tsx`: context, handler registration, scope resolution.
- `src/features/shortcuts/ShortcutHint.tsx`: display and `aria-keyshortcuts` helpers.
- `src/App.tsx` or `src/Router.tsx`: provider integration.
- `src/components/layout/AppLayout.tsx`: global navigation and assistant shortcut handlers.
- `src/components/layout/Navbar.tsx`: visible shortcut hints on nav links.
- `src/pages/DashboardPage.tsx`: dashboard command handlers and input refs.
- `src/pages/TransactionInputPage.tsx` and `src/components/features/MultiTransactionTable.tsx`: add transaction shortcuts and focused-grid behaviors.
- `src/pages/TransactionHistoryPage.tsx` and `src/components/features/TransactionTable.tsx`: filter, selection, row navigation, edit/delete, sort commands.
- `src/pages/SetupPage.tsx`: section-level CRUD, sort, selection, and collapse commands.
- `src/components/features/BulkEditModal.tsx` and `src/components/features/ConfirmDeleteModal.tsx`: modal shortcuts.
- `src/pages/SettingsPage.tsx`: Keyboard Shortcuts settings section.
- `src/components/ui/Button.tsx`: optional shortcut hint prop if this keeps call sites cleaner.

## Accessibility Requirements

- Do not remove native button/link/input semantics.
- Use `aria-keyshortcuts` only for bindings that are actually active.
- Keep visible focus states for all shortcut-editing controls.
- Do not trap users in shortcut capture mode; `Escape` cancels capture.
- Announce shortcut capture errors and conflicts in nearby text, not only toasts.
- Single-character defaults must be scoped to focused widgets and editable/removable.
- Shortcut handlers must not run while a confirm modal is open unless the modal scope owns the shortcut.

## Persistence Decision

Use `localStorage` for the first implementation because the app is local-first, single-user, and already has purely frontend settings. Do not add a database table unless future requirements include multiple browser profiles, sync, backup, or assistant-visible user preference mutations.

Store only user overrides, not the full default map. That lets future releases update default shortcuts while preserving deliberate user changes.

## Testing And Verification

- Run `npm run lint`.
- Run `npm run typecheck`.
- Run `npm run build` if provider integration touches app bootstrapping.
- Manual smoke test in the browser:
  - Navigate to every route by shortcut.
  - Open/close assistant and send a message from keyboard only.
  - Dashboard: focus dates, apply custom dates, apply presets.
  - Add Transactions: add row, categorize, parse statement, save, clear, remove focused row.
  - Transaction History: search, apply filters, select rows, edit/save/cancel/delete focused row, bulk edit/delete, sort columns.
  - Setup: expand/collapse sections, add/edit/delete/bulk-delete accounts/categories/subcategories.
  - Settings: edit, clear, reset one shortcut, reset all shortcuts, detect conflicts, reject reserved browser shortcuts.

## Implementation Risks And Tradeoffs

- Browser shortcut conflicts cannot be fully detected because browsers and assistive technologies vary. Mitigation: use conservative defaults, hard-block well-known reserved shortcuts, and let users remap everything.
- Comprehensive command coverage can make the first patch broad. Mitigation: implement the registry/provider/settings editor first, then integrate page scopes one page at a time while keeping the registry complete.
- Table/grid shortcuts are the highest-risk area because they interact with inputs, selects, paste handling, and edit mode. Mitigation: prefer focused-row commands and native input behavior before attempting advanced spreadsheet-like roving focus.
- `localStorage` is simple and local-first, but not portable across browsers. This is acceptable for the first version; export/import can be added later if needed.
