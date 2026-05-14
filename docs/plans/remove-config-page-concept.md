# Remove Config Page Concept, Preserve Setup

## Summary

The app should not expose a separate "Config" page. Keep `Setup` as its own substantive data-management page for accounts, categories, subcategories, goals, and entity colors. Keep `Settings` for app preferences and non-finance-entity configuration.

## Key Changes

1. Preserve `/setup`, `SetupPage`, the Setup navbar item, and existing setup shortcuts for accounts/categories/subcategories.
2. Audit frontend routes, navigation labels, docs, and user-facing copy for any separate "Config" or "Configuration" page concept.
3. If any config-only page or route exists beyond the current `/settings` and `/setup` structure, remove that route/nav entry and move its user-facing settings into `SettingsPage`.
4. Keep the current `SettingsPage` responsibility: OpenRouter API key instructions, assistant turn limit, flagged words, transaction amount colors, and keyboard shortcuts.
5. Do not move accounts, categories, subcategories, monthly goals, or finance entity color controls into Settings.

## Public Interfaces

- `/setup` remains valid and continues to render finance data setup.
- `/settings` remains valid and owns app preferences.
- No new API routes, database schema changes, or storage migrations are expected.
- No `/config` route or "Config" navbar item should remain if one is discovered.

## Test Plan

- Run `npm run typecheck`.
- Run `npm run lint`.
- Manually verify navigation still shows `Setup` and `Settings` separately.
- Manually verify `/setup` still manages accounts/categories/subcategories.
- Manually verify `/settings` still shows preference/configuration controls.
- Search tracked source/docs, excluding `scratchpad.md`, for stale `/config`, `ConfigPage`, and user-facing "config page" references.

## Assumptions

- "Config page" means a separate technical configuration page, not the existing `Setup` page.
- `Setup` is intentionally retained because it manages core finance entities, not lightweight preferences.
- The implementation should be committed on this worktree branch and not merged into `main`.
