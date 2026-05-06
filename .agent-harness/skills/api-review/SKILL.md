---
name: api-review
description: Reviews FastAPI endpoints against the project's API conventions — auth middleware, Pydantic v2 request/response models, LangChain callback wiring, SSE patterns, ARQ job enqueuing, CORS, and rate limiting. Validates endpoints match the spec in docs/architecture/migration-roadmap.md Phase 1. Invoke when writing or reviewing FastAPI route handlers, middleware, or worker integration code.
metadata:
  version: "1.0.0"
  domain: backend
  triggers: FastAPI review, API endpoint, endpoint review, backend review, route handler
  role: specialist
  scope: review
  output-format: report
  related-skills: code-reviewer, python-pro, supabase-schema
---

# API Endpoint Reviewer

Reviews FastAPI endpoints against the project's backend conventions and architecture spec.

## When to Use This Skill

- Writing new FastAPI route handlers
- Reviewing backend API code in PRs
- Adding middleware or dependencies
- Integrating with ARQ worker or SSE
- Checking CORS, rate limiting, or auth configuration

## Core Workflow

1. **Load Spec** -- Read `docs/architecture/migration-roadmap.md` Section 1.4 (API Endpoints) and `docs/architecture/tech-stack.md` Section 4 (Backend) for the canonical endpoint list and conventions.

2. **Scan Endpoints** -- Find all FastAPI route definitions. Check against the spec.

3. **Validate Conventions** -- For each endpoint, check every item in the checklist below.

4. **Report** -- Produce findings as Blocker / Warning / Info.

## Endpoint Checklist

### Auth

- [ ] Every non-public endpoint uses `Depends(get_current_user)` or equivalent
- [ ] `get_current_user` verifies Supabase JWT with `HS256`
- [ ] User ID extracted from `payload["sub"]`
- [ ] 401 returned for missing/invalid tokens

### Request/Response Models

- [ ] Request bodies validated with Pydantic v2 models
- [ ] Response models specified in route decorator (`response_model=`)
- [ ] Shared types between pipeline schemas and API where applicable
- [ ] No raw `dict` returns -- always typed Pydantic models

### LLM Integration

- [ ] All `.invoke()` / / `.ainvoke()` / `.abatch()` calls include `config={"callbacks": self.llm_client.callbacks}`
- [ ] No direct LLM calls from route handlers (always through pipeline or worker)

### SSE Endpoints

- [ ] SSE endpoints use `sse-starlette` or equivalent
- [ ] Subscribe to Redis pub/sub channel keyed by `run_id`
- [ ] Event format includes: event type, step name, data payload
- [ ] Connection cleanup on client disconnect

### ARQ Integration

- [ ] Pipeline runs enqueued as ARQ jobs, not executed inline in route handlers
- [ ] Job payload includes: `run_id`, `project_id`, `user_id`, `config`
- [ ] Run status set to `pending` before enqueuing
- [ ] Run status updated to `running` when worker picks up job

### CORS

- [ ] `CORSMiddleware` configured with explicit `allow_origins` (no wildcards in production)
- [ ] Only Vercel frontend domain allowed
- [ ] `allow_credentials=True` for cookie-based auth
- [ ] `allow_methods` and `allow_headers` are explicit

### Rate Limiting

- [ ] Rate limiting middleware applied
- [ ] 10 pipeline runs per hour per user
- [ ] 100 API requests per minute per user
- [ ] Rate limit headers returned in responses

### Error Handling

- [ ] `HTTPException` with appropriate status codes (400, 401, 403, 404, 422, 500)
- [ ] Consistent error response shape: `{"detail": "message"}`
- [ ] No raw stack traces in production responses
- [ ] Pydantic validation errors return 422 with field-level details

### OpenAPI

- [ ] Route descriptions and tags set for auto-generated docs
- [ ] Response models enable TypeScript type generation via `openapi-typescript`

## Constraints

### MUST DO

- Read the architecture spec before reviewing
- Check auth on every endpoint
- Verify ARQ integration for long-running operations
- Flag any direct LLM calls from route handlers

### MUST NOT DO

- Modify any files (audit only)
- Suggest patterns that deviate from FastAPI conventions
- Ignore missing auth checks

## Output Template

```
# API Review: {file or PR description}

## Endpoints Found
| Method | Path | Auth | Rate Limited | Model | Notes |
|---|---|---|---|---|---|
| POST | /api/projects | Yes | Yes | ProjectCreate | OK |
| ... |

## Findings
### Blockers
1. ...

### Warnings
1. ...

### Info
1. ...
```
