# Indexed LLM Transaction Categorization

## Summary
Change transaction categorization so the LLM selects subcategories by numeric index from a 0-based prompt list instead of returning subcategory names. Keep the public `/ai/categorize` response unchanged by resolving the numeric choice to `subcategory_id`, `subcategory_name`, `category_name`, and `source` on the backend.

## Key Changes
- List all available subcategories in the prompt as `0. [income] Category > Subcategory`.
- Ask the LLM to return only `{ "index": 0, "subcategory": 0 }` items.
- Resolve numeric subcategory choices against the same ordered subcategory list used in the prompt.
- Fall back to the direction-correct `Unassigned` subcategory when the choice is missing, invalid, out of range, or mismatched with the transaction amount direction.
- Leave frontend API types and add-transactions behavior unchanged.

## Test Plan
- Cover valid numeric resolution, including subcategory number `0`.
- Cover invalid, missing, null, non-integer, and type-mismatched choices falling back to `Unassigned`.
- Cover prompt format so `subcategory_name` is no longer requested from the LLM.
- Run `npm run test`, `npm run typecheck`, and `npm run lint`.

## Assumptions
- Numeric subcategory choices are request-local and not persisted.
- Backend fallback remains authoritative even when the LLM chooses an invalid or wrong-direction number.
