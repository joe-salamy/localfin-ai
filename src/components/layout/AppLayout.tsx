import { useCallback } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Navbar } from "./Navbar";
import { useShortcut } from "@/features/shortcuts/hooks";

export function AppLayout() {
  const navigate = useNavigate();

  useShortcut(
    "global.dashboard",
    useCallback(() => void navigate("/"), [navigate]),
  );
  useShortcut(
    "global.setup",
    useCallback(() => void navigate("/setup"), [navigate]),
  );
  useShortcut(
    "global.addTransactions",
    useCallback(() => void navigate("/transactions/input"), [navigate]),
  );
  useShortcut(
    "global.transactionHistory",
    useCallback(() => void navigate("/transactions/history"), [navigate]),
  );
  useShortcut(
    "global.settings",
    useCallback(() => void navigate("/settings"), [navigate]),
  );
  useShortcut(
    "global.keyboardShortcuts",
    useCallback(() => {
      void navigate("/settings#keyboard-shortcuts");
      window.setTimeout(
        () => document.getElementById("keyboard-shortcuts")?.focus(),
        0,
      );
    }, [navigate]),
  );

  return (
    <div className="min-h-screen bg-background text-foreground md:flex">
      <div className="min-w-0 flex-1">
        <Navbar />
        <main className="mx-auto max-w-7xl px-4 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
