import { forwardRef, useCallback, useEffect, useRef } from "react";
import type { InputHTMLAttributes } from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      className,
      indeterminate = false,
      "aria-checked": ariaChecked,
      ...props
    },
    ref,
  ) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
      if (inputRef.current) {
        inputRef.current.indeterminate = indeterminate;
      }
    }, [indeterminate]);

    const setInputRef = useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        if (node) {
          node.indeterminate = indeterminate;
        }
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [indeterminate, ref],
    );

    return (
      <span className="relative inline-flex h-4 w-4 shrink-0">
        <input
          {...props}
          ref={setInputRef}
          type="checkbox"
          aria-checked={indeterminate ? "mixed" : ariaChecked}
          className={cn(
            "peer h-4 w-4 appearance-none rounded-sm border border-border bg-background text-primary-foreground transition-colors hover:border-foreground/60 checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        />
        <Check
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden h-4 w-4 p-0.5 text-primary-foreground peer-checked:block peer-indeterminate:hidden"
        />
        <Minus
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden h-4 w-4 p-0.5 text-primary-foreground peer-indeterminate:block"
        />
      </span>
    );
  },
);

Checkbox.displayName = "Checkbox";
