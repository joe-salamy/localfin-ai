import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { DEFAULT_ENTITY_COLORS, normalizeColor } from '@/lib/colors';
import { cn } from '@/lib/utils';

interface ColorPickerProps {
  value: string | null | undefined;
  onChange: (color: string | null) => void;
  label?: string;
  className?: string;
  allowClear?: boolean;
}

export function ColorPicker({
  value,
  onChange,
  label = 'Color',
  className,
  allowClear = true,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const color = normalizeColor(value) ?? DEFAULT_ENTITY_COLORS[0];

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded border border-border bg-input px-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
          aria-label={label}
        >
          <span
            className="h-4 w-4 rounded border border-border"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          Color
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-48 rounded-md border border-border bg-card p-2 shadow-lg"
        >
          <div className="grid grid-cols-10 gap-1">
            {DEFAULT_ENTITY_COLORS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={cn(
                  'h-4 w-4 rounded border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  normalizeColor(value) === preset ? 'border-foreground' : 'border-border',
                )}
                style={{ backgroundColor: preset }}
                onClick={() => {
                  onChange(preset);
                  setOpen(false);
                }}
                aria-label={`${label} ${preset}`}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(event) => onChange(event.target.value)}
              aria-label={`${label} custom color`}
              className="h-7 w-9 cursor-pointer rounded border border-border bg-input p-0.5"
            />
            {allowClear && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="h-7 rounded border border-border px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                Auto
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
