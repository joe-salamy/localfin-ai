# Next.js 14+ App Router Patterns

## Server vs Client Components

### Decision Tree

```
Does this component need:
  - Event handlers (onClick, onChange)?        --> "use client"
  - useState, useEffect, useRef?               --> "use client"
  - Browser APIs (window, localStorage)?       --> "use client"
  - Third-party hooks (useSWR, useQuery)?      --> "use client"
  - None of the above?                         --> Server Component (default)
```

### Pattern: Server Component Fetches, Client Component Interacts

```tsx
// app/runs/[id]/page.tsx (Server Component -- fetches data)
import { RunDetail } from "@/components/pipeline/RunDetail";

export default async function RunPage({ params }: { params: { id: string } }) {
  const run = await fetchRun(params.id);
  return <RunDetail initialRun={run} />;
}

// components/pipeline/RunDetail.tsx (Client Component -- handles interaction)
"use client";
export function RunDetail({ initialRun }: { initialRun: PipelineRun }) {
  const { steps } = useRunStream(initialRun.id);
  // ... interactive UI
}
```

## Route Structure

```
app/
  (auth)/                    # Route group -- no URL segment
    login/page.tsx           # /login
    callback/page.tsx        # /callback
  (dashboard)/               # Route group -- no URL segment
    layout.tsx               # Shared sidebar + nav
    projects/
      page.tsx               # /projects
      [id]/
        page.tsx             # /projects/:id
        loading.tsx          # Loading state
        error.tsx            # Error boundary
    runs/
      [id]/
        page.tsx             # /runs/:id
        loading.tsx
        error.tsx
```

## Loading and Error States

```tsx
// app/(dashboard)/runs/[id]/loading.tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function RunLoading() {
  return (
    <div className="flex gap-4">
      <Skeleton className="h-[600px] w-[300px]" />
      <Skeleton className="h-[600px] flex-1" />
    </div>
  );
}

// app/(dashboard)/runs/[id]/error.tsx
"use client";

export default function RunError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 p-8">
      <h2 className="text-lg font-semibold">Failed to load run</h2>
      <p className="text-muted-foreground">{error.message}</p>
      <button onClick={reset} className="btn btn-primary">
        Retry
      </button>
    </div>
  );
}
```

## Middleware (Auth)

```typescript
// middleware.ts (runs on every request)
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });
  const { data: { session } } = await supabase.auth.getSession();

  if (!session && req.nextUrl.pathname.startsWith("/(dashboard)")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return res;
}

export const config = {
  matcher: ["/(dashboard)/:path*"],
};
```

## API Route Handlers

```typescript
// app/api/runs/[id]/stream/route.ts
import { NextRequest } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Proxy SSE from backend
  const backendUrl = `${process.env.API_URL}/api/runs/${params.id}/stream`;
  const token = req.headers.get("authorization");

  const response = await fetch(backendUrl, {
    headers: { Authorization: token ?? "" },
  });

  return new Response(response.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

## Data Fetching Patterns

```tsx
// Server Component -- direct fetch (preferred)
async function getProjects() {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("projects").select("*");
  if (error) throw error;
  return data;
}

// Client Component -- SWR for mutations + revalidation
"use client";
import useSWR from "swr";

function useProjects() {
  return useSWR<Project[]>("/api/projects", fetcher);
}

// Server Action (for mutations from Server Components)
"use server";

async function createProject(formData: FormData) {
  const supabase = await createServerClient();
  const name = formData.get("name") as string;
  await supabase.from("projects").insert({ name });
  revalidatePath("/projects");
}
```

## Environment Variables

```typescript
// Only NEXT_PUBLIC_ prefixed vars are available client-side
// Server-only:
//   API_URL, SUPABASE_SERVICE_KEY
// Client-accessible:
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

// Type-safe env access
function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}
```
