# Flagged Transaction Words

## Summary
Add editable browser-local flagged words, defaulting to `interest` and `fee`. Save All will show a non-blocking pop-up warning when valid rows include flagged words in the transaction name, then continue the existing save flow. Transaction history rows whose names match the configured list will render with a light red background.

## Key Changes
- First implementation step: create branch `feature/flagged-transaction-words` from `main`, then write this plan to `docs/plans/flagged-transaction-words.md`.
- Add a new client feature module, e.g. `src/features/flagged-words/`, with:
  - `localStorage` key `localfin.flaggedWords.v1`.
  - Default words `["interest", "fee"]`.
  - Normalization: trim, remove empty entries, dedupe case-insensitively, store lowercase.
  - Matching: case-insensitive substring match against transaction `name` only.
- Add a `FlaggedWordsProvider` in `src/App.tsx` and a hook used by Settings, Add Transactions, and Transaction History.
- Extend `SettingsPage` with a "Flagged Transaction Words" card:
  - Editable textarea, one word or phrase per line.
  - Save button updates the stored list.
  - Reset button restores `interest` and `fee`.
- Update `MultiTransactionTable` Save All:
  - After existing validation passes and before duplicate checking, detect flagged matches in `filledRows`.
  - If matches exist, open a modal listing matched transaction names and matched words.
  - Do not block saving; continue the current duplicate-check/save behavior.
- Update `TransactionTable`:
  - Use the same matcher for each row.
  - Apply a light red row background for flagged rows.
  - Ensure flagged styling takes precedence over amount-gradient inline background styles, while selected/focused states remain visible.

## Test Plan
- Run `npm run typecheck`.
- Run `npm run lint`.
- Manually verify:
  - Default settings show `interest` and `fee`.
  - Editing, saving, refreshing, and resetting flagged words works.
  - Save All with "Bank interest" or "ATM fee" opens the warning and still saves.
  - Save All without matches does not warn.
  - Transaction history highlights matching rows after save and after settings changes.
  - Matching is case-insensitive and based on transaction name only.

## Assumptions
- Store flagged words in browser settings/localStorage, matching existing Settings patterns.
- Warning is a pop-up modal, but it does not require confirmation before saving.
- "Contains one of those words" means substring matching, so `interest payment` and `monthly fee` match.
- No backend API, SQLite migration, or transaction schema change is needed.
