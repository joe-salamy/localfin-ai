# Suspect Transaction Scan

## Summary
Add a persisted “suspect transactions” review feature using local, explainable methods: rule checks, duplicate/near-duplicate detection, and robust statistical outlier scoring. Do not use LLM scoring in v1.

Implementation starts by creating `feature/suspect-transaction-scan` from `main`, then writing this plan to `docs/plans/suspect-transaction-scan.md`.

## Key Changes
- Add SQLite-backed scan persistence with scan runs and transaction findings.
- Add backend routes to run scans, list findings, and update finding status.
- Score exact duplicates, near duplicates, large amount outliers, merchant/category outliers, rapid small-charge clusters, missing categories, unmatched transfer-like entries, and configured flagged words.
- Add frontend hooks, scan controls, findings summary, row badges/highlighting, and finding review actions.
- Keep scans deterministic, local, and explainable; defer ML/LLM scoring until there is enough feedback data and a clear runtime choice.

## Public Interfaces
- Add shared types for scan runs, findings, reason codes, status/severity, scan requests, and scan responses.
- Add `POST /api/transactions/suspect-scan`, `GET /api/transactions/suspect-findings`, and `PUT /api/transactions/suspect-findings/:id`.
- API responses keep the existing `{ success, data, error }` shape.

## Test Plan
- Add server tests for duplicates, near duplicates, MAD outliers, missing category, flagged words, status persistence, and soft-deleted exclusion.
- Run `npm run test`.
- Run `npm run typecheck`.
- Run `npm run lint`.

## Assumptions
- “Suspect” means review anomalies, not confirmed fraud.
- Findings are persisted so users can dismiss and revisit them.
- No LLM in v1.
