---
name: docker-review
description: Validates docker-compose.yml and Dockerfiles against the project's infrastructure spec in docs/architecture/infrastructure.md. Checks service definitions, health checks, volume mounts, environment handling, dependencies, port mappings, and dev/prod profile separation. Invoke when modifying Docker configuration.
metadata:
  version: "1.0.0"
  domain: infrastructure
  triggers: Docker review, docker-compose, Dockerfile, container, infrastructure
  role: specialist
  scope: review
  output-format: report
  related-skills: api-review, migration-audit
---

# Docker Compose Validator

Validates Docker configuration against the project's infrastructure spec.

## When to Use This Skill

- Writing or modifying `docker-compose.yml`
- Creating or updating `Dockerfile` for backend
- Reviewing infrastructure changes in PRs
- Setting up local development environment

## Core Workflow

1. **Load Spec** -- Read `docs/architecture/infrastructure.md` (Section 5: Local Development Setup) and `docs/architecture/tech-stack.md` (Section 10: Development Tools).

2. **Scan Configuration** -- Read `docker-compose.yml` and any `Dockerfile` files.

3. **Validate** -- Check each item in the checklist below.

4. **Report** -- Produce findings as Blocker / Warning / Info.

## Service Checklist

### Required Services

- [ ] `api` -- FastAPI server (uvicorn)
  - Build from `./backend`
  - Command: `uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload`
  - Port: 8000
  - Depends on: redis
  - Volume mount: `./backend/src:/app/src` for hot reload
  - Environment: via `env_file: .env.local`

- [ ] `worker` -- ARQ worker (same image as API)
  - Build from `./backend` (same Dockerfile)
  - Command: `arq src.worker.WorkerSettings`
  - Depends on: redis
  - Volume mount: same as API
  - Environment: same as API
  - No port mapping (internal only)

- [ ] `redis` -- Redis 7+ Alpine
  - Image: `redis:7-alpine`
  - Port: 6379

### Optional Services (for full local stack)

- [ ] `web` -- Next.js frontend (optional, can run outside Docker)
  - Build from `./frontend`
  - Port: 3000
  - Depends on: api

### Supabase (via CLI, not Docker Compose)

The spec recommends using `supabase start` (Supabase CLI) for local DB/Auth/Storage rather than a raw Postgres container. Do not add Supabase services to Docker Compose unless there's a specific reason.

## Configuration Checks

### Environment

- [ ] Secrets via `env_file`, not hardcoded in compose file
- [ ] `.env.local` listed in `.gitignore`
- [ ] No API keys or passwords in compose file
- [ ] Environment variables match what the app expects (see `config.py` Settings class)

### Networking

- [ ] Services communicate via Docker network (service names as hostnames)
- [ ] Only necessary ports exposed to host
- [ ] Redis not exposed to host in production profile (only in dev)

### Volumes

- [ ] Source code mounted for hot reload in dev
- [ ] `node_modules` excluded from volume mount (if frontend in Docker)
- [ ] Redis data volume for persistence (optional in dev)

### Health Checks

- [ ] API service has health check (`/health` endpoint)
- [ ] Redis has health check (`redis-cli ping`)
- [ ] `depends_on` uses `condition: service_healthy` where possible

### Dockerfile

- [ ] Multi-stage build (builder + runtime) for smaller images
- [ ] Python deps installed from lockfile (deterministic builds)
- [ ] Non-root user for runtime
- [ ] `.dockerignore` excludes: `.git`, `venv`, `__pycache__`, `.env*`, `node_modules`

## Constraints

### MUST DO

- Read the infrastructure spec before reviewing
- Verify worker uses same image/build as API (different entrypoint only)
- Check that secrets are not in the compose file
- Verify port mappings match the spec

### MUST NOT DO

- Modify any files (audit only)
- Add Supabase to Docker Compose without justification
- Suggest running the frontend in Docker for dev (Next.js dev server runs better natively)

## Output Template

```
# Docker Review

## Services
| Service | Status | Image/Build | Port | Health Check | Notes |
|---|---|---|---|---|---|
| api | OK/ISSUE | ./backend | 8000 | /health | ... |
| worker | OK/ISSUE | ./backend | none | - | ... |
| redis | OK/ISSUE | redis:7-alpine | 6379 | redis-cli ping | ... |

## Findings
### Blockers
1. ...

### Warnings
1. ...

### Info
1. ...
```
