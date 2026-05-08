import { resolveEntityColor } from '@/lib/colors';
import { cn } from '@/lib/utils';

interface EntityLabelProps {
  id: string | null | undefined;
  name: string | null | undefined;
  color?: string | null;
  className?: string;
  muted?: boolean;
}

export function EntityLabel({ id, name, color, className, muted }: EntityLabelProps) {
  if (!id || !name) {
    return <span className={cn(muted && 'text-muted-foreground', className)}>-</span>;
  }

  const resolvedColor = resolveEntityColor(id, color);

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 rounded-full bg-secondary/70 px-2 py-0.5 text-xs', className)}>
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[rgba(0,0,0,0.45)_0px_1px_2px]"
        style={{ backgroundColor: resolvedColor }}
        aria-hidden="true"
      />
      <span className={cn('truncate', muted && 'text-muted-foreground')}>{name}</span>
    </span>
  );
}
