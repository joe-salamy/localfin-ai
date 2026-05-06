# Phase Checklists

## Phase 0: Pipeline Decoupling

### Files That Must Exist

| File | Purpose |
|---|---|
| `src/storage.py` | `StorageBackend` protocol + `LocalStorageBackend` |
| `src/ui_adapter.py` | `UIAdapter` protocol + `CLIAdapter` + action enums |
| `src/events.py` | `PipelineEvent` + `EventBus` |
| `src/run_state.py` | `RunState` read-through cache |
| `config.py` | `pydantic-settings` `Settings` class |

### Protocol Wiring Checks

- [ ] `EssayPipeline.__init__` accepts `StorageBackend`, `UIAdapter`, `EventBus`, `RunState`
- [ ] `_load_required_output()` delegates to `storage.latest()`
- [ ] All `input()` calls replaced with `ui.prompt_*()` methods
- [ ] All direct file writes replaced with `storage.write()`
- [ ] Events emitted via `EventBus` for: step_started, step_completed, step_skipped, pipeline_halted, info
- [ ] `main.py` wires `LocalStorageBackend`, `EventBus`, subscribes `OutputEmitter`
- [ ] `Settings` class reads from env vars with `LAWGEN_` prefix

### Tests

- [ ] Unit tests exist for StorageBackend, UIAdapter, EventBus, RunState
- [ ] Integration tests cover multi-step pipeline runs with decoupled components
- [ ] All existing tests still pass

### NOT Required in Phase 0

- Service-layer files (`src/generation/service/`) do NOT need to use StorageBackend/RunState yet
- No web-related code needed
- No monorepo restructuring

---

## Phase 1: API Layer

### Project Structure

- [ ] Monorepo structure: `backend/` and `frontend/` (or preparation for it)
- [ ] `server.py` or equivalent FastAPI entry point exists
- [ ] `Dockerfile` for backend exists

### Dependencies

- [ ] `fastapi` in requirements/pyproject.toml
- [ ] `uvicorn` in requirements/pyproject.toml
- [ ] `arq` in requirements/pyproject.toml
- [ ] `sse-starlette` in requirements/pyproject.toml

### API Endpoints (check route definitions exist)

- [ ] `POST /api/projects` -- Create project
- [ ] `GET /api/projects` -- List projects
- [ ] `POST /api/projects/{id}/runs` -- Start pipeline run
- [ ] `GET /api/projects/{id}/runs` -- List runs
- [ ] `GET /api/runs/{id}` -- Run details
- [ ] `GET /api/runs/{id}/steps/{step_name}/output` -- Step output
- [ ] `POST /api/runs/{id}/steps/{step_name}/approve` -- HITL approve
- [ ] `POST /api/runs/{id}/steps/{step_name}/refine` -- HITL refine
- [ ] `GET /api/runs/{id}/stream` -- SSE endpoint
- [ ] `GET /api/usage` -- LLM usage stats

### Auth

- [ ] JWT verification middleware exists
- [ ] `get_current_user` dependency extracts user_id from Supabase JWT

### Worker

- [ ] ARQ worker settings defined
- [ ] Worker instantiates `EssayPipeline` with web-compatible backends
- [ ] Worker publishes events to Redis pub/sub
- [ ] HITL approval flow uses Redis channels (not polling)

### Storage

- [ ] `SupabaseStorageBackend` implements `StorageBackend` protocol
- [ ] Key pattern: `{user_id}/{project_id}/{run_id}/{phase}/{step_name}.json`

### SSE

- [ ] SSE endpoint subscribes to Redis pub/sub channel keyed by `run_id`
- [ ] Events include: step_started, step_completed, step_failed, approval_needed

### CLI Preserved

- [ ] `main.py` still works with `CLIAdapter` + `LocalStorageBackend`

---

## Phase 2: Frontend MVP

### Project Structure

- [ ] `frontend/` directory with Next.js project
- [ ] `package.json` with Next.js 14+ dependency
- [ ] `tailwind.config.js` or `tailwind.config.ts`
- [ ] shadcn/ui components in `components/ui/`

### Pages

- [ ] Login page (`(auth)/login/page.tsx`)
- [ ] Auth callback (`(auth)/callback/page.tsx`)
- [ ] Dashboard layout (`(dashboard)/layout.tsx`)
- [ ] Projects list (`projects/page.tsx`)
- [ ] Project detail (`projects/[id]/page.tsx`)
- [ ] Run view (`runs/[id]/page.tsx`)

### Components

- [ ] `StepList` -- step list with status indicators
- [ ] `StepDetail` -- output preview panel
- [ ] `HitlControls` -- approve / refine / skip buttons
- [ ] `RefinementDialog` -- feedback input + conversation history
- [ ] `RunConfig` -- pipeline configuration form

### Hooks

- [ ] `useRunStream` -- SSE subscription hook
- [ ] `useAuth` -- auth state management

### Auth Flow

- [ ] Google OAuth via Supabase
- [ ] Middleware redirects unauthenticated users
- [ ] Bearer token forwarded to backend API

---

## Phase 3: History + Branching

### Run History

- [ ] Paginated run list per project
- [ ] Filters: status, phase, date range
- [ ] Metrics per run: tokens, cost, duration

### Comparison

- [ ] Side-by-side run comparison UI
- [ ] Diff view for JSON output differences

### Branching

- [ ] "Branch from here" UI on completed steps
- [ ] Creates `pipeline_runs` with `parent_run_id`
- [ ] Branch tree visualization
- [ ] Pre-branch steps reference parent outputs (no duplication)

### Version Browser

- [ ] View refinement versions within a step
- [ ] Side-by-side version diff

---

## Phase 4: Agent Harness

### Pipeline Refactoring

- [ ] `run_step()` dispatcher on phase services (public method)
- [ ] Single-item extraction from batch steps
- [ ] `custom_constraints` parameter on every step method
- [ ] `StorageBackend` extensions: `list_completed_steps()`, `list_batch_items()`, etc.
- [ ] Machine-readable `STEP_DEPENDENCIES` dict
- [ ] `PipelineError` structured error dataclass

### Agent

- [ ] LangGraph agent with state extending `MessagesState`
- [ ] 24 tools across 6 categories
- [ ] Three execution modes: regular, auto, plan
- [ ] Playbook system (YAML files)
- [ ] Knowledge directory with `MANIFEST.yaml`

### Safety

- [ ] Write access restricted to current version's output directory
- [ ] Dependency validation before step execution
- [ ] Destructive operation approval rules enforced

---

## Phase 5: Polish + Production

### Email

- [ ] Resend integration
- [ ] Configurable notification preferences

### Usage Dashboard

- [ ] Token usage per user/project/run
- [ ] Cost estimates
- [ ] Charts over time

### Error Handling

- [ ] Failed steps retryable without restarting run
- [ ] Retry with backoff for transient LLM errors
- [ ] User-facing error messages

### Mobile

- [ ] Responsive layout
- [ ] Touch-friendly HITL controls

### Documentation

- [ ] User guide
- [ ] Admin setup guide
- [ ] API reference (auto-generated from OpenAPI)
