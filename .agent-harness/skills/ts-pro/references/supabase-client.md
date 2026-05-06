# Supabase Client Patterns

## Client Setup

```typescript
// lib/supabase-browser.ts (Client Components)
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// lib/supabase-server.ts (Server Components / Route Handlers)
import { createServerClient as createSSRClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

export async function createServerClient() {
  const cookieStore = await cookies();
  return createSSRClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}
```

## Type-Safe Database Queries

```typescript
// types/database.ts (generate with: npx supabase gen types typescript)
export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          config_json: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["projects"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
      };
      pipeline_runs: {
        Row: {
          id: string;
          project_id: string;
          parent_run_id: string | null;
          status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
          phase: "research" | "plan" | "write";
          config: Record<string, unknown>;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["pipeline_runs"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["pipeline_runs"]["Insert"]>;
      };
      // ... other tables
    };
  };
}

// Typed queries
const supabase = createClient();

// Select with type inference
const { data: projects } = await supabase
  .from("projects")
  .select("id, name, description, created_at")
  .order("created_at", { ascending: false });
// data is typed as Pick<Projects["Row"], "id" | "name" | "description" | "created_at">[]

// Insert
await supabase.from("projects").insert({
  user_id: userId,
  name: "New Project",
});

// Update
await supabase
  .from("pipeline_runs")
  .update({ status: "cancelled" })
  .eq("id", runId);
```

## Auth Patterns

```tsx
// hooks/useAuth.ts
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { User } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/callback` },
    });

  const signOut = () => supabase.auth.signOut();

  return { user, loading, signInWithGoogle, signOut };
}
```

```tsx
// app/(auth)/callback/page.tsx
import { createServerClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export default async function AuthCallback({
  searchParams,
}: {
  searchParams: { code?: string };
}) {
  if (searchParams.code) {
    const supabase = await createServerClient();
    await supabase.auth.exchangeCodeForSession(searchParams.code);
  }
  redirect("/projects");
}
```

## Forwarding Auth to Backend API

```typescript
// lib/api.ts
import { createClient } from "@/lib/supabase-browser";

async function apiClient(path: string, options: RequestInit = {}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) throw new Error("Not authenticated");

  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail ?? "API error");
  }

  return res.json();
}

// Typed API functions
export async function startRun(projectId: string, config: RunConfig): Promise<PipelineRun> {
  return apiClient(`/api/projects/${projectId}/runs`, {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function approveStep(runId: string, stepName: string): Promise<void> {
  return apiClient(`/api/runs/${runId}/steps/${stepName}/approve`, {
    method: "POST",
  });
}

export async function refineStep(runId: string, stepName: string, feedback: string): Promise<void> {
  return apiClient(`/api/runs/${runId}/steps/${stepName}/refine`, {
    method: "POST",
    body: JSON.stringify({ feedback }),
  });
}
```

## Regenerate Types After Schema Changes

```bash
# After any Supabase migration:
npx supabase gen types typescript --project-id "$PROJECT_ID" > types/database.ts
```
