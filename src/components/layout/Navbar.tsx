import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Plus,
  History,
  Settings,
  SlidersHorizontal,
  WalletCards,
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
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      aria-keyshortcuts={ariaKeyShortcuts}
      title={`${label} (${shortcutLabel})`}
      className={`group flex items-center gap-3 rounded-full px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      }`}
    >
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${
        active ? "bg-black/15" : "bg-secondary group-hover:bg-muted"
      }`}>
        <Icon size={16} />
      </span>
      <span className="hidden font-bold md:inline">{label}</span>
      <span className="hidden md:inline">
        <ShortcutHint commandId={commandId} />
      </span>
    </Link>
  );
}

export function Navbar() {
  const { pathname } = useLocation();

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-card/95 px-3 py-2 shadow-[rgba(0,0,0,0.5)_0px_-8px_24px] backdrop-blur md:inset-y-0 md:left-0 md:right-auto md:w-60 md:border-r md:border-t-0 md:px-3 md:py-4 md:shadow-none">
      <div className="flex h-full items-center justify-between gap-2 md:flex-col md:items-stretch md:justify-start md:gap-4">
        <Link to="/" className="hidden items-center gap-3 px-3 py-2 text-lg font-bold text-foreground md:flex">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-black">
            <WalletCards size={19} />
          </span>
          <span>LocalFin AI</span>
        </Link>
        <div className="flex flex-1 justify-around gap-1 md:flex-none md:flex-col md:justify-start">
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
    </>
  );
}
