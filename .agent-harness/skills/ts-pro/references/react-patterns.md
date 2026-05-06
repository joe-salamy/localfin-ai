# React Patterns

## Component Composition

```tsx
// Prefer composition over prop drilling
// BAD: deeply nested props
<Dashboard user={user} theme={theme} permissions={permissions} />

// GOOD: composition with children
<DashboardLayout>
  <Sidebar>
    <ProjectNav projects={projects} />
  </Sidebar>
  <Main>
    <RunView run={run} />
  </Main>
</DashboardLayout>
```

## Props Patterns

```tsx
// Explicit props interface (always export for reuse)
interface StepListProps {
  steps: StepUpdate[];
  currentStep?: string;
  onStepClick: (stepName: string) => void;
}

// Spread native HTML attributes when wrapping elements
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
}

function Button({ variant = "primary", loading, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn("btn", `btn-${variant}`, loading && "opacity-50")}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}

// Polymorphic component with "as" prop
interface BoxProps<T extends React.ElementType = "div"> {
  as?: T;
  children: React.ReactNode;
}

function Box<T extends React.ElementType = "div">({
  as,
  children,
  ...props
}: BoxProps<T> & React.ComponentPropsWithoutRef<T>) {
  const Component = as ?? "div";
  return <Component {...props}>{children}</Component>;
}
```

## State Patterns

```tsx
// useReducer for complex state
type StepAction =
  | { type: "step_started"; stepName: string }
  | { type: "step_completed"; stepName: string; outputKey: string }
  | { type: "step_failed"; stepName: string; error: string };

interface StepState {
  steps: Map<string, StepUpdate>;
  currentStep: string | null;
}

function stepReducer(state: StepState, action: StepAction): StepState {
  switch (action.type) {
    case "step_started":
      return {
        ...state,
        currentStep: action.stepName,
        steps: new Map(state.steps).set(action.stepName, {
          step_name: action.stepName,
          status: "running",
        }),
      };
    case "step_completed":
      return {
        ...state,
        steps: new Map(state.steps).set(action.stepName, {
          step_name: action.stepName,
          status: "completed",
          output_key: action.outputKey,
        }),
      };
    case "step_failed":
      return {
        ...state,
        steps: new Map(state.steps).set(action.stepName, {
          step_name: action.stepName,
          status: "failed",
        }),
      };
  }
}
```

## Custom Hooks

```tsx
// Hook for API calls with loading/error state
function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(url)
      .then((res) => res.json())
      .then((json: T) => {
        if (!cancelled) setData(json);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [url]);

  return { data, error, loading };
}

// Hook for debounced values
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
```

## Error Boundaries

```tsx
"use client";

import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset);
    }
    return this.props.children;
  }
}
```

## Ref Patterns

```tsx
// Forward ref for reusable components
import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, ...props }, ref) => (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <input ref={ref} className={cn("input", error && "border-red-500")} {...props} />
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
);
Input.displayName = "Input";
```
