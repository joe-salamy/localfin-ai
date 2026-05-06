# TypeScript Type System

## Strict Mode Essentials

```typescript
// tsconfig.json "strict": true enables all of these:
// strictNullChecks, strictFunctionTypes, strictBindCallApply,
// strictPropertyInitialization, noImplicitAny, noImplicitThis,
// alwaysStrict, useUnknownInCatchVariables

// Additional recommended flags:
// noUncheckedIndexedAccess -- array/object index returns T | undefined
// exactOptionalPropertyTypes -- optional props can't be explicitly undefined
// noImplicitOverride -- require "override" keyword
```

## Interfaces vs Types

```typescript
// Use interface for object shapes (extendable, mergeable)
interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
}

interface ProjectWithRuns extends User {
  runs: PipelineRun[];
}

// Use type for unions, intersections, mapped types
type RunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "waiting_for_approval";

type ApiResponse<T> = { data: T; error: null } | { data: null; error: string };
```

## Utility Types

```typescript
// Pick / Omit for subsetting
type RunSummary = Pick<PipelineRun, "id" | "status" | "phase" | "createdAt">;
type RunWithoutMeta = Omit<PipelineRun, "createdAt" | "updatedAt">;

// Partial / Required
type RunUpdate = Partial<PipelineRun>;
type StrictRunConfig = Required<RunConfig>;

// Record for dictionaries
type StepOutputMap = Record<string, StepOutput>;

// Extract / Exclude for unions
type ActiveStatus = Extract<RunStatus, "running" | "paused">;
type TerminalStatus = Exclude<RunStatus, "pending" | "running" | "paused">;

// ReturnType / Parameters
type FetchResult = ReturnType<typeof fetchRun>;
type FetchParams = Parameters<typeof fetchRun>;
```

## Generics

```typescript
// Generic function
function assertDefined<T>(value: T | null | undefined, name: string): T {
  if (value == null) {
    throw new Error(`Expected ${name} to be defined`);
  }
  return value;
}

// Generic component props
interface ListProps<T> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  keyExtractor: (item: T) => string;
}

function List<T>({ items, renderItem, keyExtractor }: ListProps<T>) {
  return (
    <ul>
      {items.map((item) => (
        <li key={keyExtractor(item)}>{renderItem(item)}</li>
      ))}
    </ul>
  );
}

// Constrained generic
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
```

## Discriminated Unions

```typescript
// Pattern: shared "type" field for narrowing
interface StepStarted {
  type: "step_started";
  stepNum: number;
  stepName: string;
}

interface StepCompleted {
  type: "step_completed";
  stepNum: number;
  stepName: string;
  outputKey: string;
}

interface StepFailed {
  type: "step_failed";
  stepNum: number;
  stepName: string;
  error: string;
}

type PipelineEvent = StepStarted | StepCompleted | StepFailed;

// Exhaustive switch
function handleEvent(event: PipelineEvent): string {
  switch (event.type) {
    case "step_started":
      return `Step ${event.stepNum} started`;
    case "step_completed":
      return `Step ${event.stepNum} done: ${event.outputKey}`;
    case "step_failed":
      return `Step ${event.stepNum} failed: ${event.error}`;
    // No default needed -- TypeScript ensures exhaustiveness
  }
}
```

## Type Guards and Narrowing

```typescript
// Custom type guard
function isStepCompleted(event: PipelineEvent): event is StepCompleted {
  return event.type === "step_completed";
}

// Using unknown instead of any
function parseApiResponse(raw: unknown): PipelineRun {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Expected object");
  }
  // Use Zod for runtime validation of unknown data
  return PipelineRunSchema.parse(raw);
}

// Assertion function
function assertNonNull<T>(value: T | null | undefined): asserts value is T {
  if (value == null) throw new Error("Unexpected null");
}
```

## Zod for Runtime Validation

```typescript
import { z } from "zod";

// Define schema (runtime) and infer type (compile-time)
const PipelineRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: z.enum(["pending", "running", "paused", "completed", "failed", "cancelled"]),
  phase: z.enum(["research", "plan", "write"]),
  config: z.record(z.unknown()),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

type PipelineRun = z.infer<typeof PipelineRunSchema>;

// Validate API response
async function fetchRun(runId: string): Promise<PipelineRun> {
  const res = await fetch(`/api/runs/${runId}`);
  const json: unknown = await res.json();
  return PipelineRunSchema.parse(json);
}
```

## Template Literal Types

```typescript
// API route patterns
type ApiRoute = `/api/${string}`;
type RunRoute = `/api/runs/${string}`;
type StepRoute = `/api/runs/${string}/steps/${string}`;

// Event names
type EventName = `${string}_started` | `${string}_completed` | `${string}_failed`;
```
