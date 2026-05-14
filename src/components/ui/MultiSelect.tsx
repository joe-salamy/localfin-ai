import { forwardRef, useMemo, useState } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  value: string[];
  onChange: (value: string[]) => void;
  options: MultiSelectOption[];
  allLabel: string;
  selectedLabel: string;
  emptyLabel?: string;
}

export const MultiSelect = forwardRef<HTMLButtonElement, MultiSelectProps>(
  (
    {
      value,
      onChange,
      options,
      allLabel,
      selectedLabel,
      emptyLabel = 'No options',
      className,
      disabled,
      ...props
    },
    ref,
  ) => {
    const [open, setOpen] = useState(false);
    const selectedValues = useMemo(() => new Set(value), [value]);
    const firstSelected = options.find((option) => selectedValues.has(option.value));

    const label = value.length === 0
      ? allLabel
      : value.length === 1
        ? firstSelected?.label ?? selectedLabel
        : `${value.length} ${selectedLabel}`;

    const toggleValue = (nextValue: string) => {
      if (selectedValues.has(nextValue)) {
        onChange(value.filter((item) => item !== nextValue));
        return;
      }

      onChange([...value, nextValue]);
    };

    return (
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            ref={ref}
            type="button"
            disabled={disabled}
            className={cn(
              'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-input px-3 py-1 text-xs text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
            {...props}
          >
            <span className="min-w-0 truncate text-left">{label}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 w-56 rounded-md border border-border bg-popover p-1 text-xs text-popover-foreground shadow-md"
          >
            <div className="max-h-64 overflow-y-auto">
              {options.length === 0 ? (
                <div className="px-2 py-2 text-muted-foreground">{emptyLabel}</div>
              ) : (
                options.map((option) => {
                  const selected = selectedValues.has(option.value);

                  return (
                    <button
                      key={option.value}
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => toggleValue(option.value)}
                    >
                      <span
                        className={cn(
                          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-border',
                          selected && 'bg-primary text-primary-foreground',
                        )}
                        aria-hidden="true"
                      >
                        {selected && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 truncate">{option.label}</span>
                    </button>
                  );
                })
              )}
            </div>
            {value.length > 0 && (
              <button
                type="button"
                className="mt-1 flex w-full items-center justify-center gap-1 rounded border-t border-border px-2 py-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onChange([])}
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  },
);

MultiSelect.displayName = 'MultiSelect';
