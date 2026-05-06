# Item #7: Simplify Chain Generator

Source: `docs/architecture/pipeline-vs-agent-architecture.md` Part 7, Section 7.2

## Current State

`ChainGenerator` in `src/generation/generators.py` builds LCEL pipelines:
`RunnableLambda(render_templates) | prompt | RunnableLambda(call_llm)`

### What It Does (must be preserved)

1. Strict Jinja2 template rendering with schema injection
2. Structured output with `include_raw=True`
3. Parse-failure diagnostics using raw model response
4. Metadata assembly: `tokens`, `response_time_minutes`, `input_messages`, `llm_response`

### Where It's Over-Abstracted

- Dynamic-schema steps repeatedly create throwaway `ChainGenerator` instances inline
- The LCEL `RunnableLambda` chain adds indirection without reducing complexity
- Every chain follows the same render-then-call pattern (no actual composability used)

## Target State

Replace `ChainGenerator` with a thin invocation layer:

```python
def invoke_structured(
    *,
    llm_client: LLMClient,
    prompt_system: PromptSystem,
    system_template: str,
    user_template: str,
    schema: type[BaseModel],
    inputs: dict,
    allow_empty: list[str] | None = None,
    config: dict | None = None,
) -> dict:
    """Render templates, call LLM with structured output, return result with metadata."""
    ...

def batch_structured(
    *,
    llm_client: LLMClient,
    prompt_system: PromptSystem,
    system_template: str,
    user_template: str,
    schema: type[BaseModel],
    batch_inputs: list[dict],
    allow_empty: list[str] | None = None,
    config: dict | None = None,
    max_workers: int = 10,
) -> list[dict]:
    """Batch version of invoke_structured."""
    ...
```

## Metadata Contract (CRITICAL)

The refinement flow in `pipeline.py` depends on these metadata fields. They MUST be preserved in any new invoker.

### Required Fields

| Field | Type | Used By | Purpose |
|---|---|---|---|
| `_metadata.input_messages` | `list[dict]` | `_launch_refinement_session()` | Full LangChain message history for multi-turn refinement |
| `_metadata.tokens.input` | `int` | Token tracking, LLM warnings | Input token count |
| `_metadata.tokens.output` | `int` | Token tracking, LLM warnings | Output token count |
| `_metadata.tokens.reasoning` | `int \| None` | Token tracking | Reasoning token count (if available) |
| `_metadata.response_time_minutes` | `float` | Performance logging | Wall-clock time |
| `_metadata.llm_response` | `str` | Parse failure diagnostics | Raw LLM response text |
| `_metadata.output_context_used_pct` | `float` | LLM warnings | Percent of output context used |

### How to Verify

Before starting the refactor:

```python
# Contract test example
def test_metadata_contract(result: dict):
    meta = result["_metadata"]
    assert "input_messages" in meta
    assert isinstance(meta["input_messages"], list)
    assert all(isinstance(m, dict) for m in meta["input_messages"])
    assert "tokens" in meta
    assert "input" in meta["tokens"]
    assert "output" in meta["tokens"]
    assert "response_time_minutes" in meta
    assert isinstance(meta["response_time_minutes"], (int, float))
```

## Verification Checks

- [ ] Contract tests written for all metadata fields BEFORE starting refactor
- [ ] `invoke_structured()` produces identical metadata shape as `ChainGenerator`
- [ ] `batch_structured()` produces identical metadata shape
- [ ] `include_raw=True` behavior preserved (raw response accessible for diagnostics)
- [ ] Template rendering uses `StrictUndefined` (catches missing variables)
- [ ] `timed_llm_call` wrapper behavior preserved (timing, error handling)
- [ ] Dynamic schema steps work with the new invoker
- [ ] Refinement flow works end-to-end with new metadata
- [ ] All existing tests pass

## Implementation Order (from spec)

1. Add contract tests for metadata fields
2. Extract `invoke_structured()` equivalent to current `ChainGenerator` behavior
3. Migrate one step to use the new invoker (verify tests pass)
4. Migrate remaining steps incrementally
5. Remove `ChainGenerator` when all steps are migrated
