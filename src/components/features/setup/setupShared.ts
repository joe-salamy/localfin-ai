import type { ProviderConnectionSummary } from "@shared/contracts";
import type { ResizableColumnDef } from "@/features/table-layout/useResizableColumns";

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}



export function formatProviderName(provider: ProviderConnectionSummary["provider"]) {
  return provider === "plaid" ? "Plaid" : "Akoya";
}

export function formatConnectionStatus(status: ProviderConnectionSummary["status"]) {
  return status.replace("_", " ");
}

export function formatDateTime(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function summarizeProviderSync(
  results: {
    accountsUpserted: number;
    transactionsAdded: number;
    transactionsUpdated: number;
    transactionsRemoved: number;
  }[],
) {
  const totals = results.reduce(
    (sum, result) => ({
      accounts: sum.accounts + result.accountsUpserted,
      added: sum.added + result.transactionsAdded,
      updated: sum.updated + result.transactionsUpdated,
      removed: sum.removed + result.transactionsRemoved,
    }),
    { accounts: 0, added: 0, updated: 0, removed: 0 },
  );

  return `Synced ${totals.accounts} account(s), added ${totals.added} transaction(s), updated ${totals.updated}, removed ${totals.removed}.`;
}

export const SETUP_ACCOUNT_COLUMN_DEFS = [
  { id: "select", defaultWidth: 48 },
  { id: "name", defaultWidth: 180 },
  { id: "type", defaultWidth: 112 },
  { id: "color", defaultWidth: 96 },
  { id: "initialBalance", defaultWidth: 140 },
  { id: "balance", defaultWidth: 140 },
  { id: "actions", defaultWidth: 112 },
] satisfies ResizableColumnDef[];

export const SETUP_CATEGORY_COLUMN_DEFS = [
  { id: "select", defaultWidth: 48 },
  { id: "name", defaultWidth: 200 },
  { id: "type", defaultWidth: 112 },
  { id: "color", defaultWidth: 96 },
  { id: "actions", defaultWidth: 96 },
] satisfies ResizableColumnDef[];

export const SETUP_SUBCATEGORY_COLUMN_DEFS = [
  { id: "select", defaultWidth: 48 },
  { id: "name", defaultWidth: 200 },
  { id: "category", defaultWidth: 180 },
  { id: "monthlyGoal", defaultWidth: 140 },
  { id: "color", defaultWidth: 96 },
  { id: "actions", defaultWidth: 96 },
] satisfies ResizableColumnDef[];


export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
