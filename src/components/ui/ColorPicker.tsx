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
            'inline-flex h-7 items-center gap-1.5 rounded-full border-0 bg-input px-2 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
          aria-label={label}
        >
          <span
            className="h-4 w-4 rounded-full shadow-[rgb(124,124,124)_0px_0px_0px_1px_inset]"
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
          className="z-50 w-48 rounded-lg border-0 bg-card p-2 shadow-[rgba(0,0,0,0.5)_0px_8px_24px]"
        >
          <div className="grid grid-cols-10 gap-1">
            {DEFAULT_ENTITY_COLORS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={cn(
                  'h-4 w-4 rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  normalizeColor(value) === preset ? 'shadow-[rgb(255,255,255)_0px_0px_0px_2px]' : 'shadow-[rgb(77,77,77)_0px_0px_0px_1px]',
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
              className="h-7 w-9 cursor-pointer rounded-full border-0 bg-input p-0.5"
            />
            {allowClear && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="h-7 rounded-full bg-secondary px-3 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
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
