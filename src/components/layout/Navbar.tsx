import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Plus,
  History,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import type { CommandId } from "@/features/shortcuts/commands";
import { ShortcutHint } from "@/features/shortcuts/ShortcutHint";
import { useShortcutMetadata } from "@/features/shortcuts/hooks";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, commandId: "global.dashboard" },
  { to: "/setup", label: "Setup", icon: SlidersHorizontal, commandId: "global.setup" },
  { to: "/transactions/input", label: "Add", icon: Plus, commandId: "global.addTransactions" },
  { to: "/transactions/history", label: "History", icon: History, commandId: "global.transactionHistory" },
  { to: "/settings", label: "Settings", icon: Settings, commandId: "global.settings" },
] as const satisfies ReadonlyArray<{ to: string; label: string; icon: typeof LayoutDashboard; commandId: CommandId }>;

function NavLink({ to, label, icon: Icon, commandId, active }: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  commandId: CommandId;
  active: boolean;
}) {
  const { ariaKeyShortcuts, label: shortcutLabel } = useShortcutMetadata(commandId);

  return (
    <Link
      to={to}
      aria-keyshortcuts={ariaKeyShortcuts}
      title={`${label} (${shortcutLabel})`}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon size={16} />
      {label}
      <ShortcutHint commandId={commandId} />
    </Link>
  );
}

export function Navbar() {
  const { pathname } = useLocation();

  return (
    <nav className="h-14 border-b border-border bg-card px-4">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between">
        <Link to="/" className="text-lg font-bold text-foreground">
          Budget
        </Link>
        <div className="flex gap-1">
          {links.map(({ to, label, icon, commandId }) => (
            <NavLink
              key={to}
              to={to}
              label={label}
              icon={icon}
              commandId={commandId}
              active={pathname === to}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}
