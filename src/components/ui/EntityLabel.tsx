import { resolveEntityColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

interface EntityLabelProps {
  id: string | null | undefined;
  name: string | null | undefined;
  color?: string | null;
  className?: string;
  muted?: boolean;
}

export function EntityLabel({
  id,
  name,
  color,
  className,
  muted,
}: EntityLabelProps) {
  if (!id || !name) {
    return (
      <span className={cn(muted && "text-muted-foreground", className)}>-</span>
    );
  }

  const resolvedColor = resolveEntityColor(id, color);

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: resolvedColor }}
        aria-hidden="true"
      />
      <span className={cn("truncate", muted && "text-muted-foreground")}>
        {name}
      </span>
    </span>
  );
}
