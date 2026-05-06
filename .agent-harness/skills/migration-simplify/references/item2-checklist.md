# Item #2: Flatten Service/Mixin Hierarchy

Source: `docs/architecture/pipeline-vs-agent-architecture.md` Part 7, Section 7.1

## Current State

Mixins carry hidden state contracts across files. Step methods depend on `self._stepN_*` mappings implicitly.

### Plan Phase

| Mixin | File | Steps | Hidden State |
|---|---|---|---|
| `Steps24Mixin` | `src/generation/service/plan/steps_2_4.py` | 2, 3, 4 | `_step3_rule_component_mapping`, `_step4_rule_component_mapping`, `_step4_case_mapping` |
| `Steps57Mixin` | `src/generation/service/plan/steps_5_7.py` | 5, 6, 7 | `_step5_rule_component_mapping`, `_step5_test_concept_mapping`, `_step6_rule_component_mapping`, `_step6_test_concept_mappings`, `_step6_case_mappings` |
| `Steps811Mixin` | `src/generation/service/plan/steps_8_11.py` | 8, 9, 10, 11 | (check for any step-specific state) |

### Write Phase

| Mixin | File | Steps |
|---|---|---|
| `Steps12Mixin` | `src/generation/service/write/steps_1_2.py` | 1, 2 |
| `Steps34Mixin` | `src/generation/service/write/steps_3_4.py` | 3, 4 |
| `Steps510Mixin` | `src/generation/service/write/steps_5_10.py` | 5-10 |
| `ReviseMixin` | `src/generation/service/write/revise.py` | revision passes |

### Research Phase

| Mixin | File | Steps |
|---|---|---|
| `Steps16Mixin` | `src/generation/service/research/steps_1_6.py` | 1-6 |

## Target State

### Explicit State Containers

```python
@dataclass
class StepDeps:
    llm_client: LLMClient
    prompt_system: PromptSystem
    pipeline: EssayPipeline
    output_dir: Path

@dataclass
class PlanStepState:
    step3_rule_component_mapping: dict[int, str] = field(default_factory=dict)
    step4_rule_component_mapping: dict[int, str] = field(default_factory=dict)
    step4_case_mapping: dict[int, str] = field(default_factory=dict)
    step5_rule_component_mapping: dict[int, str] = field(default_factory=dict)
    step5_test_concept_mapping: dict[int, str] = field(default_factory=dict)
    step6_rule_component_mapping: dict[int, str] = field(default_factory=dict)
    step6_test_concept_mappings: dict[str, dict[int, str]] = field(default_factory=dict)
    step6_case_mappings: dict[str, dict[int, str]] = field(default_factory=dict)
```

### Standalone Step Functions

```python
def step4_draft_test_concepts(inputs: dict, deps: StepDeps, state: PlanStepState) -> dict: ...
def post_process_step4(result: dict, file_path: Path, state: PlanStepState) -> None: ...
```

## Verification Checks

For each migrated step:

- [ ] Step function is standalone (not a method on a mixin class)
- [ ] All dependencies passed explicitly via `StepDeps` and phase-specific state
- [ ] No `self._stepN_*` references remain
- [ ] Refinement post-processing still works with explicit state
- [ ] Pipeline `run_step()` can dispatch to the new function
- [ ] Existing tests pass after migration

## Migration Order (from spec)

1. Plan steps 2-4 (start with simplest, validate pattern)
2. Plan steps 5-7 (highest mapping complexity)
3. Remaining plan/write/research mixins as separate slices
