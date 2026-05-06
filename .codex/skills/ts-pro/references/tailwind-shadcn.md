# Tailwind CSS + shadcn/ui

## Tailwind Conventions

### Class Organization

Order classes logically: layout > sizing > spacing > typography > colors > effects > states.

```tsx
// Layout > Size > Spacing > Typography > Colors > Effects > States
<div className="flex items-center gap-4 w-full max-w-2xl p-4 text-sm text-gray-700 bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow" />
```

### Responsive Design

Mobile-first: base classes are mobile, prefixed classes are larger breakpoints.

```tsx
// Mobile: stack, Tablet: side-by-side, Desktop: wider gap
<div className="flex flex-col gap-2 md:flex-row md:gap-4 lg:gap-6">
  <aside className="w-full md:w-64 lg:w-80">
    {/* Sidebar */}
  </aside>
  <main className="flex-1">
    {/* Content */}
  </main>
</div>
```

### cn() Helper for Conditional Classes

```tsx
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Usage
<div className={cn(
  "rounded-lg border p-4",
  status === "completed" && "border-green-500 bg-green-50",
  status === "failed" && "border-red-500 bg-red-50",
  status === "running" && "border-blue-500 bg-blue-50 animate-pulse",
)} />
```

## shadcn/ui Component Patterns

### Installation

```bash
npx shadcn@latest init
npx shadcn@latest add button dialog tabs data-table card badge
```

Components are copied into `components/ui/` as source files -- full ownership, no dependency lock-in.

### Common Components for This Project

```tsx
// Step status badge
import { Badge } from "@/components/ui/badge";

function StepStatusBadge({ status }: { status: StepStatus }) {
  const variants: Record<StepStatus, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline",
    running: "default",
    completed: "secondary",
    failed: "destructive",
    skipped: "outline",
    waiting_for_approval: "default",
  };

  return <Badge variant={variants[status]}>{status.replace("_", " ")}</Badge>;
}
```

```tsx
// HITL approval dialog
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function RefinementDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (feedback: string) => void;
}) {
  const [feedback, setFeedback] = useState("");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refine Step Output</DialogTitle>
        </DialogHeader>
        <Textarea
          placeholder="Describe what should change..."
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          className="min-h-[120px]"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(feedback)}>
            Submit Feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

```tsx
// Data table for run history
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";

const runColumns: ColumnDef<PipelineRun>[] = [
  { accessorKey: "version_label", header: "Version" },
  { accessorKey: "phase", header: "Phase" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StepStatusBadge status={row.getValue("status")} />,
  },
  {
    accessorKey: "created_at",
    header: "Started",
    cell: ({ row }) => formatDate(row.getValue("created_at")),
  },
];
```

```tsx
// Tabs for phase navigation
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function PhaseTabs({ runId }: { runId: string }) {
  return (
    <Tabs defaultValue="plan">
      <TabsList>
        <TabsTrigger value="research">Research</TabsTrigger>
        <TabsTrigger value="plan">Plan</TabsTrigger>
        <TabsTrigger value="write">Write</TabsTrigger>
      </TabsList>
      <TabsContent value="research">
        <StepList runId={runId} phase="research" />
      </TabsContent>
      <TabsContent value="plan">
        <StepList runId={runId} phase="plan" />
      </TabsContent>
      <TabsContent value="write">
        <StepList runId={runId} phase="write" />
      </TabsContent>
    </Tabs>
  );
}
```

### Dark Mode

```tsx
// tailwind.config.ts
export default {
  darkMode: "class",
  // ...
};

// Usage: prefix dark: for dark mode variants
<div className="bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100" />
```
