---
name: prompt-schema-conventions
description: Audits prompt templates (prompt-templates/) and Pydantic schemas (src/schemas/) against this project's conventions — partial usage, naming, index system, reasoning fields, structured-output discipline. Invoke when adding a new prompt template, a new Pydantic schema, or modifying either. Audit-only — does not write changes.
metadata:
  version: "1.0.0"
  domain: prompts
  triggers: prompt review, schema review, prompt conventions, schema conventions, new prompt, new schema, partial extraction
  role: specialist
  scope: audit
  output-format: report
  related-skills: code-reviewer, api-review, cross-stack-types
---

# Prompt + Schema Conventions

Audits prompt templates and Pydantic schemas against the project's conventions. Surfaces drift, missing partials, naming inconsistencies, and gaps that hurt LLM output quality or downstream type safety.

## When to Use This Skill

- Adding a new prompt template under `prompt-templates/`
- Adding a new Pydantic schema under `src/schemas/`
- Modifying either, especially when copy-pasting from a sibling template/schema
- Before merging a PR that touches the prompt or schema layer

## When NOT to Use

- Pure backend or frontend code review (use `code-reviewer` or `api-review`)
- Cross-stack type drift (use `cross-stack-types`)
- General Python style (use `python-pro`)

## Core Workflow

1. **Load context**
   - Read `CLAUDE.md` — section "Architecture Rules", "Code Style", "Editing Rules".
   - Read `docs/repo-info/index-system.md` — full index-system convention.
   - Read `docs/repo-info/naming-conventions.md` if present.
   - Read `prompt-templates/_partials/*.md` — list every existing partial and what it contains.
   - Read `src/schemas/base.py` — note `BaseResponse` config (`extra=`, `populate_by_name`, etc.).

2. **Scope detection**
   - If changes are under `prompt-templates/`: identify the affected templates and their paired schema(s).
   - If changes are under `src/schemas/`: identify the affected models and the prompt template(s) that produce matching output.
   - For a paired audit (both layers): map each template → schema and confirm the mapping is intentional.

3. **Run the checklist** below. Categorize every finding as **Blocker** (must fix), **Warning** (should fix), or **Info** (FYI).

4. **Report** using the Output Template.

## Audit Checklist

### Naming

- [ ] Step name is `verb_noun` snake_case (e.g., `draft_paragraph`, `extract_facts`).
- [ ] Template filename is kebab-case with no leading numbers (e.g., `draft-paragraph-system.md`, NOT `7-draft-paragraph-system.md`).
- [ ] No abbreviated identifiers in templates or schemas: `test_concept` not `tc`, `rule_component` not `rc`, `argument` not `arg` (unless in `arg_index` which is established).
- [ ] Reasoning fields use one of two canonical names by default:
  - `reasoning: str` — single-decision justification (1 paragraph or 1 sentence). Use when the model has only one reasoning concept in its response shape.
  - `strategic_reasoning: list[str]` — multi-bullet retrospective notes on strategic choices.
  - `justification` and `rationale` → flag as Blocker; rename to `reasoning` (or to `strategic_reasoning` if list-shaped).
  - **Carve-out for coexistence:** When two reasoning concepts coexist *in the same response shape* — either on the same model, or split across a parent model and its nested children — each must use a semantic prefix that clearly disambiguates the two decisions. Examples currently in the codebase:
    - `PrecedentCaseAnalysisResponse.suitability_reasoning` + `.procedural_direction_reasoning` (two siblings on one model — each justifies a different `pass`/`fail` decision).
    - `FactAllocationItem.fact_type_reasoning` + nested `ArgumentAllocation.reasoning` (item-level `good`/`bad` rationale vs. per-argument allocation rationale; the prompt template explicitly distinguishes them by name to prevent LLM confusion — see `prompt-templates/plan/allocate-facts-system.md`).
  - Names like `suitability_reasoning`, `procedural_direction_reasoning`, `fact_type_reasoning` are acceptable *only* when justified by the carve-out; in any other context, flag as Blocker and suggest renaming to `reasoning`.
- [ ] Case-name prefixing: `current_case_*` and `precedent_case_*`, not bare `case_*`. Bare `case_*` is allowed only inside a single-case nested object where context is unambiguous.
- [ ] `summary` is reserved for narrative case-level prose; `description` is reserved for definitional/structural items (e.g., what a rule component requires). Don't mix.

### Partials

- [ ] Any 3+-line block that is byte-identical (or close to it) across multiple templates uses `{% include "_partials/<name>.md" %}` instead of being copy-pasted.
- [ ] Every system template ends with `{% include "_partials/output_format_json.md" %}` (NOT a raw `{{ json_schema(schema) }}` block — that wrapper is centralized).
- [ ] When a "near-duplicate" block is intentionally NOT extracted (because each variant differs meaningfully), the variation is justified in the PR description, not just in implicit prose drift. Drift across templates is a Warning even when not extracted.
- [ ] Every partial referenced by an `{% include %}` exists in `prompt-templates/_partials/`.

### Index System

- [ ] When the prompt sends a list of items to the LLM, the template numbers them with `[{{ loop.index }}]` (1-based, per Jinja).
- [ ] Schema includes a corresponding `*_index: int = Field(ge=1, ...)` field; `dynamic_schemas.py` adds the upper bound (`le=len(items)`).
- [ ] Post-LLM, `_replace_index_with_text(...)` is called from `src/generation/service/plan/utils.py` to swap the index for the resolved text field.
- [ ] If the step supports refine mode, the index mapping is stored as an instance attribute and `post_process: lambda result, fp: self._post_process_<step>(result)` is wired into `run_step()`.
- [ ] Cross-batch index scope (global vs. per-component) matches the table in `docs/repo-info/index-system.md`.

### Schema Quality

- [ ] Every `Field(...)` has a non-empty `description=`. The description is sent to the LLM in the structured-output schema, so vague descriptions silently degrade quality. The description should be specific enough that a stranger could fill in the field correctly without reading the prompt.
- [ ] Categorical fields use `Literal[...]`, not bare `str`. (`Literal["pass", "fail"]`, not `str`.)
- [ ] Numeric/string ranges stated in the prompt have matching `ge` / `le` / `min_length` / `max_length` constraints on the schema. If the prompt says "60–150 words", the corresponding string field should have a soft `max_length` upper bound.
- [ ] Substantive LLM choices (selection, ranking, allocation, classification) have a `reasoning` or `strategic_reasoning` field on the same model.
- [ ] Schemas extend `BaseResponse` (or a documented exception) so they pick up `model_config`.
- [ ] `_metadata.input_messages` is written by the calling code (per CLAUDE.md architecture rule — refinement depends on it).

### Output Format

- [ ] Markdown content sent to the LLM is *embedded in JSON string fields*; no template asks for raw markdown as the entire LLM response.
- [ ] When a prompt mandates **named `## sections`** (not free-flowing prose), those sections are split into typed Pydantic sub-fields, not stored as one large markdown blob. Mandated structure should be Pydantic-enforceable.
- [ ] Long persuasive prose (Statement of Facts, Introduction, Paragraph, Weave, Conclusion) stays as a single string field — splitting rhetorical structure into JSON keys adds output-token cost without enabling validation.

### Cross-Stack

- [ ] If the schema is exposed via the API (used in a FastAPI route's request/response model), regenerate the frontend types after change: `cd frontend && npm run generate-types` (requires API server running).
- [ ] CLI entry path (`main.py`) still works — per CLAUDE.md, every change must preserve CLI alongside web app.
- [ ] Schema changes that rename or split fields require a migration plan for stored JSON outputs in `pipeline-outputs/` (or an explicit decision that old runs are unreadable post-rename).

### Prompt-Template Hygiene

- [ ] Template uses Jinja2 `StrictUndefined` semantics — every `{{ var }}` is either provided in the render call or listed in `allow_empty=`. The `PromptSystem.render_template()` signature in `src/prompt_system.py` is the source of truth.
- [ ] No prompt template is exposed to the user (per CLAUDE.md architecture rule). Step *outputs* are visible; templates are not.
- [ ] No template hard-codes a model name, provider, or API key — all that lives in the LLM client config.
- [ ] System prompt and user prompt are in separate files (`<step-name>-system.md`, `<step-name>-user.md`), not concatenated.

## Constraints

### MUST DO

- Read `CLAUDE.md` and `docs/repo-info/index-system.md` before starting.
- Inspect every existing partial under `_partials/` so you know what's already factored.
- Trace at least one schema → its prompt template to confirm the schema fields match what the prompt asks for.
- Cite specific files and line ranges as evidence in every finding.

### MUST NOT DO

- Modify any files (audit only).
- Recommend extracting a "near-duplicate" block as a partial unless the variation is small enough to be parameterized cleanly. Drift is a real cost; so is an over-engineered partial. Both should be weighed.
- Silently rewrite any template's wording to make a partial fit. If the prose differs, the difference is a deliberate signal to the LLM until proven otherwise.
- Recommend index-system adoption for steps that need full text (e.g., per-fact prose for paragraph drafting). Indexes are for cross-step references, not for compressing first-class content.

## Output Template

```
# Prompt + Schema Conventions Audit: {file or PR description}

## Scope
- Templates touched: {list}
- Schemas touched: {list}
- Pairings verified: {schema → template list}

## Findings

### Blockers
1. **{Title}** — {file:lines}. {What's wrong and why it must change.}
2. ...

### Warnings
1. ...

### Info
1. ...

## Drift Watch (optional)
List of "near-duplicate" blocks across templates that were considered for partial extraction but rejected, with the rationale for each. Lets future authors avoid re-litigating the same call.

| Block | Templates | Why not extracted |
|---|---|---|
| ... | ... | ... |
```
