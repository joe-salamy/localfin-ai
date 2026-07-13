export function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    asset: "bg-emerald-900/50 text-emerald-400",
    liability: "bg-red-900/50 text-red-400",
    income: "bg-blue-900/50 text-blue-400",
    expense: "bg-orange-900/50 text-orange-400",
  };

  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${colors[type] ?? "bg-secondary text-foreground"}`}
    >
      {type}
    </span>
  );
}
