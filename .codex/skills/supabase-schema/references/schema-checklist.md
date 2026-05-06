# Schema Checklist

Cross-reference every item against `docs/architecture/data-architecture.md`.

## Tables

### Required Tables (Section 2)

- [ ] `users` -- id (UUID PK), email (UNIQUE), google_id (UNIQUE), display_name, created_at, updated_at
- [ ] `projects` -- id (UUID PK), user_id (FK users, CASCADE), name, description, config_json (JSONB), created_at, updated_at
- [ ] `pipeline_runs` -- id (UUID PK), project_id (FK projects, CASCADE), parent_run_id (FK self, SET NULL), branch_point_step, version_label, phase (ENUM), status (ENUM), config (JSONB), created_at, started_at, completed_at
- [ ] `pipeline_steps` -- id (UUID PK), run_id (FK pipeline_runs, CASCADE), step_number, step_name, phase (ENUM), status (ENUM), started_at, completed_at, output_storage_key, token_usage (JSONB), error_message, UNIQUE(run_id, step_number)
- [ ] `run_state` -- id (UUID PK), run_id (FK pipeline_runs, CASCADE), key, value_json (JSONB), produced_by_step (FK pipeline_steps, CASCADE), updated_at, UNIQUE(run_id, key)
- [ ] `hitl_decisions` -- id (UUID PK), step_id (FK pipeline_steps, CASCADE), user_id (FK users, CASCADE), action (ENUM), feedback_text, refinement_version, created_at
- [ ] `llm_usage` -- id (UUID PK), user_id (FK users, CASCADE), run_id (FK pipeline_runs, CASCADE), step_id (FK pipeline_steps, CASCADE), provider, model, input_tokens, output_tokens, cost_usd (DECIMAL), created_at
- [ ] `notifications` -- id (UUID PK), user_id (FK users, CASCADE), run_id (FK pipeline_runs, CASCADE), type (ENUM), message, sent_at, read_at

### ENUM Types

- [ ] `run_phase`: research, plan, write
- [ ] `run_status`: pending, running, paused, completed, failed, cancelled
- [ ] `step_status`: pending, running, completed, failed, skipped
- [ ] `hitl_action`: approve, reject, refine, skip, edit
- [ ] `notification_type`: step_complete, run_complete, run_failed, hitl_required, usage_alert

## Indexes (Section 2)

- [ ] `idx_users_email` ON users (email)
- [ ] `idx_users_google_id` ON users (google_id)
- [ ] `idx_projects_user_id` ON projects (user_id)
- [ ] `idx_runs_project_id` ON pipeline_runs (project_id)
- [ ] `idx_runs_parent_run_id` ON pipeline_runs (parent_run_id)
- [ ] `idx_runs_status` ON pipeline_runs (status)
- [ ] `idx_runs_project_phase` ON pipeline_runs (project_id, phase)
- [ ] `idx_steps_run_id` ON pipeline_steps (run_id)
- [ ] `idx_steps_status` ON pipeline_steps (status)
- [ ] `idx_run_state_run_id` ON run_state (run_id)
- [ ] `idx_run_state_key` ON run_state (run_id, key)
- [ ] `idx_hitl_step_id` ON hitl_decisions (step_id)
- [ ] `idx_hitl_user_id` ON hitl_decisions (user_id)
- [ ] `idx_llm_usage_user_id` ON llm_usage (user_id)
- [ ] `idx_llm_usage_run_id` ON llm_usage (run_id)
- [ ] `idx_llm_usage_step_id` ON llm_usage (step_id)
- [ ] `idx_llm_usage_created_at` ON llm_usage (created_at)
- [ ] `idx_notifications_user_id` ON notifications (user_id)
- [ ] `idx_notifications_unread` ON notifications (user_id, read_at) WHERE read_at IS NULL

## Foreign Key Cascades

| FK | On Delete | Rationale |
|---|---|---|
| projects.user_id -> users | CASCADE | Delete user = delete their projects |
| pipeline_runs.project_id -> projects | CASCADE | Delete project = delete runs |
| pipeline_runs.parent_run_id -> pipeline_runs | SET NULL | Delete parent preserves child runs |
| pipeline_steps.run_id -> pipeline_runs | CASCADE | Delete run = delete steps |
| run_state.run_id -> pipeline_runs | CASCADE | Delete run = delete state |
| run_state.produced_by_step -> pipeline_steps | CASCADE | Delete step = delete state entry |
| hitl_decisions.step_id -> pipeline_steps | CASCADE | Delete step = delete decisions |
| hitl_decisions.user_id -> users | CASCADE | Delete user = delete decisions |
| llm_usage.* -> respective parents | CASCADE | Delete parent = delete usage records |
| notifications.user_id -> users | CASCADE | Delete user = delete notifications |
| notifications.run_id -> pipeline_runs | CASCADE | Delete run = delete notifications |

## SSOT Pattern (Section 4)

Shared data MUST go through `run_state`, not cross-file reads:

| Key | Produced By | Consumed By |
|---|---|---|
| `case_summary` | Plan step 1 (summarize_current_case) | Plan 2-11, Write 1-10 |
| `rule_components` | Plan step 4 (draft_test_concepts) | Plan 5-11, Write 1-10 |
| `test_concepts` | Plan step 4 (draft_test_concepts) | Plan 5-11, Write 3-10 |
| `fact_inventory` | Plan step 10 (build_fact_inventory) | Write 5, 8, 11 |

## Migration Best Practices

- [ ] Use `IF NOT EXISTS` for creates
- [ ] Use `IF EXISTS` for drops
- [ ] Include both UP and DOWN migrations where possible
- [ ] Don't mix schema changes with data migrations
- [ ] Test RLS policies after every migration
