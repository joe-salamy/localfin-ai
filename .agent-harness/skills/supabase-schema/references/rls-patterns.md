# RLS Policy Patterns

## Required Policies (from data-architecture.md)

### Direct User Tables

Tables with a `user_id` column get a direct ownership policy:

```sql
-- projects
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_projects" ON projects
  FOR ALL USING (auth.uid() = user_id);

-- notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_notifications" ON notifications
  FOR ALL USING (auth.uid() = user_id);
```

### Indirect User Tables

Tables without `user_id` that relate through a parent with `user_id`:

```sql
-- pipeline_runs (has user_id directly in migration-roadmap Phase 1 spec)
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_runs" ON pipeline_runs
  FOR ALL USING (user_id = auth.uid());

-- pipeline_steps (access through run -> user_id)
ALTER TABLE pipeline_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_steps" ON pipeline_steps
  FOR ALL USING (
    run_id IN (SELECT id FROM pipeline_runs WHERE user_id = auth.uid())
  );

-- run_state (access through run -> user_id)
ALTER TABLE run_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_run_state" ON run_state
  FOR ALL USING (
    run_id IN (SELECT id FROM pipeline_runs WHERE user_id = auth.uid())
  );

-- hitl_decisions (has user_id directly)
ALTER TABLE hitl_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_hitl" ON hitl_decisions
  FOR ALL USING (user_id = auth.uid());

-- llm_usage (has user_id directly)
ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_usage" ON llm_usage
  FOR ALL USING (user_id = auth.uid());
```

### Storage Bucket

```sql
-- Object storage: users access own outputs
CREATE POLICY "Users access own outputs"
ON storage.objects
FOR ALL
USING (
  bucket_id = 'pipeline-outputs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
```

## Common RLS Mistakes

1. **Missing ENABLE RLS** -- Creating policies without `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` means the policies are ignored.

2. **SELECT-only policies** -- Using `FOR SELECT` when the app also needs INSERT/UPDATE/DELETE. Use `FOR ALL` unless you need separate logic per operation.

3. **Subquery performance** -- Deeply nested subqueries in RLS policies can cause performance issues. For tables with direct `user_id`, always use the direct check.

4. **Service role bypass** -- The `service_role` key bypasses RLS. Only use it in backend server code, never expose to client.

5. **Missing policies on new tables** -- Every table with user data MUST have RLS enabled and at least one policy.

## Testing RLS

```sql
-- Test as a specific user
SET request.jwt.claims = '{"sub": "user-uuid-here"}';
SET role = 'authenticated';

-- Should return only this user's projects
SELECT * FROM projects;

-- Should fail or return empty for another user's data
SELECT * FROM pipeline_runs WHERE user_id != 'user-uuid-here';
```
