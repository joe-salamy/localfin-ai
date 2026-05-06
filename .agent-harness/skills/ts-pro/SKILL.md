---
name: ts-pro
description: Use when building TypeScript + Next.js 14+ applications requiring strict type safety, React Server Components, App Router patterns, Tailwind CSS, and shadcn/ui. Generates type-safe TypeScript code, validates with ESLint and tsc --strict, reviews component architecture, and enforces Next.js best practices. Invoke for TypeScript development, Next.js pages, React components, Tailwind styling, frontend best practices, SSE hooks, Supabase client patterns.
license: MIT
metadata:
  version: "1.0.0"
  domain: language
  triggers: TypeScript development, Next.js, React components, Tailwind CSS, shadcn/ui, frontend, App Router, server components
  role: specialist
  scope: implementation
  output-format: code
  related-skills: python-pro, api-review, cross-stack-types
---

# TypeScript Pro

Modern TypeScript + Next.js 14+ specialist focused on type-safe, performant, production-ready frontend code. The TypeScript counterpart to `/python-pro`.

## When to Use This Skill

- Writing type-safe TypeScript with strict mode
- Building Next.js App Router pages, layouts, and route handlers
- Deciding between Server Components and Client Components
- Creating React components with Tailwind CSS and shadcn/ui
- Setting up SSE hooks for real-time updates
- Integrating Supabase Auth and data fetching on the client
- Generating TypeScript types from OpenAPI specs

## Core Workflow

1. **Analyze** -- Review component structure, type coverage, Next.js patterns in use
2. **Design** -- Define interfaces, component boundaries, data flow (server vs client)
3. **Implement** -- Write TypeScript with strict mode, proper React patterns, Tailwind utilities
4. **Validate** -- Run `tsc --strict`, ESLint, Prettier
   - If tsc fails: fix type errors before proceeding
   - If ESLint reports issues: apply fixes, then re-validate

## Reference Guide

| Topic              | Reference                           | Load When                                     |
| ------------------ | ----------------------------------- | --------------------------------------------- |
| Type System        | `references/type-system.md`         | TypeScript strict mode, generics, utility types |
| Next.js Patterns   | `references/nextjs-patterns.md`     | App Router, layouts, server/client components  |
| React Patterns     | `references/react-patterns.md`      | Hooks, state, component composition            |
| Tailwind + shadcn  | `references/tailwind-shadcn.md`     | Styling, component library usage               |
| Supabase Client    | `references/supabase-client.md`     | Auth hooks, RLS-aware queries, realtime        |

## Constraints

### MUST DO

- `"strict": true` in tsconfig.json (no exceptions)
- Explicit return types on exported functions
- Use `interface` for object shapes, `type` for unions/intersections
- Server Components by default; add `"use client"` only when needed (event handlers, hooks, browser APIs)
- Tailwind utility classes for styling (no CSS modules, no styled-components)
- shadcn/ui for UI primitives (Dialog, Tabs, DataTable, etc.)
- `fetch` or server actions for data fetching in Server Components
- Proper `loading.tsx`, `error.tsx`, `not-found.tsx` for each route segment
- Type-safe API calls using generated types from OpenAPI spec

### MUST NOT DO

- Skip type annotations on exported functions or component props
- Use `any` (use `unknown` + type narrowing instead)
- Put data fetching in Client Components when it can be a Server Component
- Use `useEffect` for data fetching (use Server Components or SWR/React Query)
- Mix Tailwind with inline styles or CSS-in-JS
- Import server-only code in Client Components
- Use `as` type assertions when type narrowing is possible
- Hardcode API URLs (use environment variables)

## Code Examples

### Server Component with data fetching

```tsx
// app/projects/page.tsx (Server Component -- no "use client")
import { createServerClient } from "@/lib/supabase-server";
import { ProjectList } from "@/components/pipeline/ProjectList";

export default async function ProjectsPage() {
  const supabase = await createServerClient();
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, name, description, created_at")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return <ProjectList projects={projects} />;
}
```

### Client Component with SSE hook

```tsx
// components/pipeline/RunProgress.tsx
"use client";

import { useRunStream } from "@/hooks/useRunStream";
import { StepList } from "./StepList";
import { HitlControls } from "./HitlControls";

interface RunProgressProps {
  runId: string;
}

export function RunProgress({ runId }: RunProgressProps) {
  const { steps, currentStep, status } = useRunStream(runId);

  return (
    <div className="flex gap-4">
      <StepList steps={steps} currentStep={currentStep} />
      {currentStep?.status === "waiting_for_approval" && (
        <HitlControls runId={runId} stepName={currentStep.name} />
      )}
    </div>
  );
}
```

### SSE hook pattern

```tsx
// hooks/useRunStream.ts
"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface StepUpdate {
  step_name: string;
  status: "pending" | "running" | "completed" | "failed" | "waiting_for_approval";
  output_key?: string;
}

export function useRunStream(runId: string) {
  const [steps, setSteps] = useState<StepUpdate[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${runId}/stream`);
    eventSourceRef.current = es;

    es.addEventListener("step_update", (event) => {
      const data: StepUpdate = JSON.parse(event.data);
      setSteps((prev) => {
        const idx = prev.findIndex((s) => s.step_name === data.step_name);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = data;
          return next;
        }
        return [...prev, data];
      });
    });

    es.onerror = () => {
      // EventSource auto-reconnects; no manual handling needed
    };

    return () => es.close();
  }, [runId]);

  const currentStep = steps.find(
    (s) => s.status === "running" || s.status === "waiting_for_approval"
  );

  return { steps, currentStep, status: currentStep?.status ?? "idle" };
}
```

### tsconfig.json strict configuration

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "jsx": "preserve",
    "module": "esnext",
    "moduleResolution": "bundler",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

## Output Templates

When implementing TypeScript features, provide:

1. Component/module file with complete type annotations
2. Props interface (for components) or function signatures
3. Type checking confirmation (`tsc --strict` passes)
4. Brief note on Server vs Client Component decision

## Knowledge Reference

TypeScript 5+, Next.js 14+ App Router, React 18+ Server Components, Tailwind CSS 3+, shadcn/ui, Radix UI primitives, Zod, SWR, React Query, ESLint, Prettier, Supabase JS client
