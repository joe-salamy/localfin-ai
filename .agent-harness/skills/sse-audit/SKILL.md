---
name: sse-audit
description: Audits Server-Sent Events (SSE) implementation for correctness and reliability. Validates the full chain — worker Redis pub/sub, FastAPI SSE endpoint, frontend EventSource hook — against the architecture spec. Checks reconnection, last-event-id, HITL flow, and polling fallback. Invoke when working on real-time features, SSE endpoints, or the useRunStream hook.
metadata:
  version: "1.0.0"
  domain: infrastructure
  triggers: SSE audit, server-sent events, real-time, EventSource, streaming, useRunStream
  role: specialist
  scope: audit
  output-format: report
  related-skills: api-review, ts-pro
---

# SSE + Real-Time Audit

Validates the SSE implementation chain from worker to browser against the architecture spec.

## When to Use This Skill

- Implementing or modifying SSE endpoints
- Working on the `useRunStream` hook
- Debugging real-time update issues
- Reviewing Redis pub/sub integration
- Checking HITL approval flow through SSE

## Core Workflow

1. **Load Spec** -- Read `docs/architecture/tech-stack.md` Section 7 (Real-time Updates) and `docs/architecture/migration-roadmap.md` Section 1.5 (Worker) for the canonical SSE architecture.

2. **Trace the Chain** -- Audit each link in the real-time chain:
   ```
   ARQ Worker --> Redis pub/sub --> FastAPI SSE endpoint --> Browser EventSource
   ```

3. **Check Reliability** -- SSE reliability is flagged in the migration roadmap risk register. Verify mitigations are in place.

4. **Report** -- Produce findings.

## Architecture Reference

```
ARQ Worker                    FastAPI                      Next.js Client
    |                            |                              |
    |-- publish step_complete -->|                              |
    |   (Redis pub/sub)          |-- SSE event ---------------->|
    |                            |                              |
    |-- publish llm_token ------>|                              |
    |   (Redis pub/sub)          |-- SSE event ---------------->|
    |                            |                              |
    |                            |<-- POST /approve-step -------|
    |<-- enqueue next step ------|                              |
```

## Checklist

### Worker (Publisher)

- [ ] Worker publishes events to Redis pub/sub channel keyed by `run:{run_id}`
- [ ] Events include: `step_started`, `step_completed`, `step_failed`, `approval_needed`, `progress_update`
- [ ] Each event includes a monotonically increasing event ID (for `last-event-id` replay)
- [ ] Worker does NOT call Resend/external APIs directly (events only)
- [ ] HITL approval flow: worker writes `waiting_for_approval` to DB, then awaits Redis message on `hitl:{run_id}:{step_name}`

### FastAPI SSE Endpoint

- [ ] Route: `GET /api/runs/{run_id}/stream`
- [ ] Auth: requires valid JWT (verified via `get_current_user`)
- [ ] Subscribes to Redis pub/sub channel `run:{run_id}`
- [ ] Streams events as SSE format: `event: {type}\ndata: {json}\nid: {event_id}\n\n`
- [ ] Supports `Last-Event-ID` header for reconnection replay
- [ ] Handles client disconnect (unsubscribes from Redis channel, cleans up)
- [ ] Connection timeout / keepalive configured (send `:keepalive\n\n` every 15-30s)

### Frontend (Subscriber)

- [ ] `useRunStream` hook (or equivalent) creates `EventSource` connection
- [ ] EventSource URL includes auth (via query param or cookie, since EventSource doesn't support headers)
- [ ] Handles `onmessage` / `addEventListener` for typed events
- [ ] EventSource auto-reconnects on error (built-in behavior)
- [ ] `last-event-id` sent automatically on reconnect
- [ ] Hook cleans up EventSource on component unmount (`es.close()`)
- [ ] State updates use functional setState to avoid stale closures

### HITL Flow

- [ ] When worker pauses for approval:
  1. Worker publishes `approval_needed` event with step details
  2. SSE streams event to client
  3. Client shows HITL controls
  4. User clicks Approve/Refine
  5. Client POSTs to `/api/runs/{id}/steps/{name}/approve` or `/refine`
  6. API publishes decision to Redis channel `hitl:{run_id}:{step_name}`
  7. Worker picks up decision and continues

### Reliability Mitigations

- [ ] `last-event-id` replay: server stores recent events (Redis list or in-memory buffer) and replays on reconnect
- [ ] Polling fallback: `GET /api/runs/{id}` returns current state on 30s interval as backup
- [ ] Keepalive: server sends `:keepalive` comments to prevent proxy/CDN timeouts
- [ ] Event deduplication: client ignores events with IDs already processed

## Constraints

### MUST DO

- Trace the full chain (worker -> Redis -> FastAPI -> browser)
- Check `last-event-id` support (the primary reliability mechanism)
- Verify HITL approval flow end-to-end
- Check for resource cleanup on disconnect

### MUST NOT DO

- Modify any files (audit only)
- Suggest WebSocket replacement (SSE is the architectural decision)
- Ignore auth on the SSE endpoint

## Output Template

```
# SSE Audit

## Chain Status
| Link | Status | Notes |
|---|---|---|
| Worker -> Redis pub/sub | OK/ISSUE | ... |
| Redis -> FastAPI SSE | OK/ISSUE | ... |
| FastAPI -> Browser EventSource | OK/ISSUE | ... |
| HITL approval flow | OK/ISSUE | ... |

## Reliability
| Mitigation | Implemented | Notes |
|---|---|---|
| last-event-id replay | YES/NO | ... |
| Polling fallback | YES/NO | ... |
| Keepalive | YES/NO | ... |
| Event deduplication | YES/NO | ... |

## Findings
### Blockers
1. ...

### Warnings
1. ...

### Info
1. ...
```
