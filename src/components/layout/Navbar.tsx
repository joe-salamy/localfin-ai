import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Plus, History, Settings, SlidersHorizontal } from 'lucide-react';

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/transactions/input', label: 'Add', icon: Plus },
  { to: '/transactions/history', label: 'History', icon: History },
  { to: '/setup', label: 'Setup', icon: SlidersHorizontal },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Navbar() {
  const { pathname } = useLocation();

  return (
    <nav className="border-b border-border bg-card px-4 py-3">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <Link to="/" className="text-lg font-bold text-foreground">
          Budget
        </Link>
        <div className="flex gap-1">
          {links.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                pathname === to
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
