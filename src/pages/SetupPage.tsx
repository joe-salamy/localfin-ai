import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { toast } from "sonner";
import { usePlaidLink } from "react-plaid-link";
import type {
  PlaidLinkError,
  PlaidLinkOnSuccessMetadata,
} from "react-plaid-link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Plus,
  Lock,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SimpleSelect } from "@/components/ui/SimpleSelect";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { EntityLabel } from "@/components/ui/EntityLabel";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDeleteModal } from "@/components/features/ConfirmDeleteModal";
import { useAccounts } from "@/hooks/useAccounts";
import { useAccountLinking } from "@/hooks/useAccountLinking";
import { useCategories } from "@/hooks/useCategories";
import { useTransactions } from "@/hooks/useTransactions";
import type {
  AccountWithBalance,
  Category,
  ProviderConnectionSummary,
  Subcategory,
  TargetInstitution,
} from "@/types";
import { ShortcutHint } from "@/features/shortcuts/ShortcutHint";
import { useShortcut, useShortcutScope } from "@/features/shortcuts/hooks";
import { useUndoRedo } from "@/features/undo-redo/hooks";
import {
  useResizableColumns,
  type ResizableColumnDef,
} from "@/features/table-layout/useResizableColumns";
import { handleEnterSave } from "@/lib/enterSave";
import { useSuccessToast } from "@/features/display-settings/hooks";

// ─── Helpers ──────────────────────────────────────────────

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function TypeBadge({ type }: { type: string }) {
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

type PlaidTargetInstitution = Extract<
  TargetInstitution,
  "us_bank" | "discover"
>;

function formatProviderName(provider: ProviderConnectionSummary["provider"]) {
  return provider === "plaid" ? "Plaid" : "Akoya";
}

function formatConnectionStatus(status: ProviderConnectionSummary["status"]) {
  return status.replace("_", " ");
}

function formatDateTime(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function summarizeProviderSync(
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
const PLAID_OAUTH_STORAGE_KEY = "localfin:plaid-oauth-link";

const SETUP_ACCOUNT_COLUMN_DEFS = [
  { id: "select", defaultWidth: 48 },
  { id: "name", defaultWidth: 180 },
  { id: "type", defaultWidth: 112 },
  { id: "color", defaultWidth: 96 },
  { id: "initialBalance", defaultWidth: 140 },
  { id: "balance", defaultWidth: 140 },
  { id: "actions", defaultWidth: 112 },
] satisfies ResizableColumnDef[];

const SETUP_CATEGORY_COLUMN_DEFS = [
  { id: "select", defaultWidth: 48 },
  { id: "name", defaultWidth: 200 },
  { id: "type", defaultWidth: 112 },
  { id: "color", defaultWidth: 96 },
  { id: "actions", defaultWidth: 96 },
] satisfies ResizableColumnDef[];

const SETUP_SUBCATEGORY_COLUMN_DEFS = [
  { id: "select", defaultWidth: 48 },
  { id: "name", defaultWidth: 200 },
  { id: "category", defaultWidth: 180 },
  { id: "monthlyGoal", defaultWidth: 140 },
  { id: "color", defaultWidth: 96 },
  { id: "actions", defaultWidth: 96 },
] satisfies ResizableColumnDef[];

function readStoredPlaidOAuthLinkToken(
  targetInstitution: PlaidTargetInstitution,
) {
  if (
    typeof window === "undefined" ||
    !window.location.href.includes("oauth_state_id")
  ) {
    return null;
  }
  try {
    const stored = window.sessionStorage.getItem(PLAID_OAUTH_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as {
      targetInstitution?: unknown;
      linkToken?: unknown;
    };
    if (
      parsed.targetInstitution !== targetInstitution ||
      typeof parsed.linkToken !== "string" ||
      !parsed.linkToken
    ) {
      return null;
    }
    return parsed.linkToken;
  } catch {
    return null;
  }
}

function storePlaidOAuthLinkToken(
  targetInstitution: PlaidTargetInstitution,
  linkToken: string,
) {
  try {
    window.sessionStorage.setItem(
      PLAID_OAUTH_STORAGE_KEY,
      JSON.stringify({ targetInstitution, linkToken }),
    );
  } catch {
    // If session storage is unavailable, non-OAuth Plaid Link still works.
  }
}

function clearStoredPlaidOAuthLinkToken() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PLAID_OAUTH_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

interface PlaidConnectButtonProps {
  targetInstitution: PlaidTargetInstitution;
  label: string;
  createLinkToken: (input: {
    targetInstitution: PlaidTargetInstitution;
  }) => Promise<{ data?: { link_token: string | null } }>;
  exchangePublicToken: (input: {
    publicToken: string;
    targetInstitution: PlaidTargetInstitution;
    metadata: unknown;
  }) => Promise<unknown>;
  loading?: boolean;
}

function PlaidConnectButton({
  targetInstitution,
  label,
  createLinkToken,
  exchangePublicToken,
  loading,
}: PlaidConnectButtonProps) {
  const successToast = useSuccessToast();
  const [linkToken, setLinkToken] = useState<string | null>(() =>
    readStoredPlaidOAuthLinkToken(targetInstitution),
  );
  const [shouldOpen, setShouldOpen] = useState(
    () => readStoredPlaidOAuthLinkToken(targetInstitution) !== null,
  );
  const receivedRedirectUri =
    typeof window !== "undefined" &&
    window.location.href.includes("oauth_state_id")
      ? window.location.href
      : undefined;

  const { open, ready } = usePlaidLink({
    token: linkToken,
    ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
    onSuccess: (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      void exchangePublicToken({
        publicToken,
        targetInstitution,
        metadata,
      })
        .then(() => {
          successToast("Plaid account connected");
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to connect Plaid account",
          );
        })
        .finally(() => {
          clearStoredPlaidOAuthLinkToken();
          setLinkToken(null);
          setShouldOpen(false);
        });
    },
    onExit: (error: PlaidLinkError | null) => {
      if (error) {
        toast.error(
          error.display_message || error.error_message || "Plaid Link exited",
        );
      }
      clearStoredPlaidOAuthLinkToken();
      setShouldOpen(false);
    },
  });

  useEffect(() => {
    if (!shouldOpen || !ready || !linkToken) return;
    open();
    setShouldOpen(false);
  }, [linkToken, open, ready, shouldOpen]);

  async function handleClick() {
    try {
      const result = await createLinkToken({ targetInstitution });
      const nextToken = result.data?.link_token;
      if (!nextToken) {
        throw new Error("Plaid Link token was not returned.");
      }
      storePlaidOAuthLinkToken(targetInstitution, nextToken);
      setLinkToken(nextToken);
      setShouldOpen(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to start Plaid Link",
      );
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={handleClick}
      loading={loading || (shouldOpen && !ready)}
    >
      {label}
    </Button>
  );
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

type SortDirection = "asc" | "desc";

interface SortConfig<TKey extends string> {
  key: TKey;
  direction: SortDirection;
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function applySortDirection(value: number, direction: SortDirection) {
  return direction === "asc" ? value : -value;
}

function nextSort<TKey extends string>(
  current: SortConfig<TKey>,
  key: TKey,
): SortConfig<TKey> {
  if (current.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

function SortHeader<TKey extends string>({
  label,
  sortKey,
  sort,
  align = "left",
  onSort,
}: {
  label: string;
  sortKey: TKey;
  sort: SortConfig<TKey>;
  align?: "left" | "right";
  onSort: (key: TKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = active
    ? sort.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 font-medium hover:text-foreground ${
        align === "right" ? "justify-end" : ""
      }`}
      onClick={() => onSort(sortKey)}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <Icon size={12} aria-hidden="true" />
    </button>
  );
}

// ─── Section wrapper ──────────────────────────────────────

function CollapsibleSection({
  title,
  count,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <button
        type="button"
        className="flex w-full items-center justify-between p-4"
        onClick={() => onOpenChange(!open)}
      >
        <span className="text-lg font-semibold text-foreground">
          {title}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({count})
          </span>
        </span>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {open && <CardContent className="px-4 pb-4">{children}</CardContent>}
    </Card>
  );
}

// ─── Accounts Section ─────────────────────────────────────
function AccountsSection() {
  const {
    accounts,
    isLoading,
    createAccount,
    updateAccount,
    reconcileAccount,
    deleteAccount,
    restoreAccount,
  } = useAccounts();
  const {
    connections,
    isLoading: providerConnectionsLoading,
    createPlaidLinkToken,
    exchangePlaidPublicToken,
    startAkoyaAuthorization,
    syncProviderConnections,
    disconnectProviderConnection,
  } = useAccountLinking();
  const successToast = useSuccessToast();
  const { execute } = useUndoRedo();
  const { deleteTransaction, restoreTransaction } = useTransactions();
  type AccountSortKey = "name" | "type" | "balance";

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"asset" | "liability">("asset");
  const [balance, setBalance] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<"asset" | "liability">("asset");
  const [editInitialBalance, setEditInitialBalance] = useState("");
  const [editColor, setEditColor] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<AccountWithBalance | null>(
    null,
  );
  const [reconcileTarget, setReconcileTarget] =
    useState<AccountWithBalance | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [disconnectTarget, setDisconnectTarget] =
    useState<ProviderConnectionSummary | null>(null);
  const [disconnectingProvider, setDisconnectingProvider] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [sectionFocused, setSectionFocused] = useState(false);
  const [sort, setSort] = useState<SortConfig<AccountSortKey>>({
    key: "name",
    direction: "asc",
  });
  const {
    columns,
    totalWidth,
    getColStyle,
    getHeaderStyle,
    getResizeHandleProps,
  } = useResizableColumns("setup.accounts", SETUP_ACCOUNT_COLUMN_DEFS);

  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => {
      let result = 0;

      if (sort.key === "name") {
        result = compareText(a.name, b.name);
      } else if (sort.key === "type") {
        result = compareText(a.type, b.type);
      } else {
        result = a.current_balance - b.current_balance;
      }

      return applySortDirection(result, sort.direction);
    });
  }, [accounts, sort]);

  const selectableIds = useMemo(
    () => sortedAccounts.map((a) => a.id),
    [sortedAccounts],
  );
  const selectedCount = selectedIds.size;
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedIds.has(id));
  const focusedAccount =
    sortedAccounts.find((account) => account.id === focusedId) ??
    sortedAccounts[0] ??
    null;

  useShortcutScope(
    "setupAccounts",
    sectionFocused || showAdd || editId !== null,
  );

  async function submitAddAccount() {
    if (!name.trim()) return;
    const payload = {
      name: name.trim(),
      type,
      initial_balance: balance ? parseFloat(balance) : 0,
      color,
    };
    let createdId: string | null = null;
    setSaving(true);
    try {
      await execute({
        id: crypto.randomUUID(),
        label: "Create account",
        apply: async () => {
          try {
            const result = await createAccount.mutateAsync(payload);
            createdId = result.data?.id ?? null;
            if (!createdId)
              throw new Error("Account creation returned no account.");
            successToast("Account created");
            setName("");
            setBalance("");
            setColor(null);
            setType("asset");
            setShowAdd(false);
          } catch {
            toast.error("Failed to create account");
            throw new Error("Failed to create account");
          }
        },
        undo: async () => {
          if (createdId) await deleteAccount.mutateAsync(createdId);
        },
        redo: async () => {
          if (createdId) await restoreAccount.mutateAsync(createdId);
        },
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    await submitAddAccount();
  }

  async function handleUpdate(id: string) {
    if (!editName.trim()) return;
    const before = accounts.find((account) => account.id === id);
    const updates = {
      name: editName.trim(),
      type: editType,
      initial_balance: editInitialBalance ? parseFloat(editInitialBalance) : 0,
      color: editColor,
    };
    setSaving(true);
    try {
      if (!before) {
        await updateAccount.mutateAsync({ id, ...updates });
      } else {
        const applied = await execute({
          id: crypto.randomUUID(),
          label: "Update account",
          apply: async () => {
            await updateAccount.mutateAsync({ id, ...updates });
          },
          undo: async () => {
            await updateAccount.mutateAsync({
              id,
              name: before.name,
              type: before.type,
              initial_balance: before.initial_balance,
              color: before.color,
            });
          },
          redo: async () => {
            await updateAccount.mutateAsync({ id, ...updates });
          },
        });
        if (!applied) throw new Error("Failed to update account");
      }
      successToast("Account updated");
      setEditId(null);
    } catch {
      toast.error("Failed to update account");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    try {
      const applied = await execute({
        id: crypto.randomUUID(),
        label: "Delete account",
        apply: async () => {
          await deleteAccount.mutateAsync(target.id);
        },
        undo: async () => {
          await restoreAccount.mutateAsync(target.id);
        },
        redo: async () => {
          await deleteAccount.mutateAsync(target.id);
        },
      });
      if (!applied) throw new Error("Failed to delete account");
      successToast("Account deleted");
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
      setDeleteTarget(null);
    } catch {
      toast.error("Failed to delete account");
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const snapshots = accounts.filter((account) => selectedIds.has(account.id));
    const ids = snapshots.map((account) => account.id);
    try {
      const applied = await execute({
        id: crypto.randomUUID(),
        label: "Delete accounts",
        apply: async () => {
          for (const id of ids) {
            await deleteAccount.mutateAsync(id);
          }
        },
        undo: async () => {
          for (const id of ids) {
            await restoreAccount.mutateAsync(id);
          }
        },
        redo: async () => {
          for (const id of ids) {
            await deleteAccount.mutateAsync(id);
          }
        },
      });
      if (!applied) throw new Error("Failed to delete selected accounts");
      setSelectedIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      successToast(`${ids.length} accounts deleted`);
      setShowBulkDelete(false);
    } catch {
      toast.error("Failed to delete selected accounts");
    } finally {
      setDeleting(false);
    }
  }

  async function handleStartAkoyaAuthorization() {
    try {
      const result = await startAkoyaAuthorization.mutateAsync({
        targetInstitution: "fidelity",
      });
      const authorizationUrl = result.data?.authorizationUrl;
      if (!authorizationUrl) {
        throw new Error("Akoya authorization URL was not returned.");
      }
      window.location.href = authorizationUrl;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to start Akoya authorization",
      );
    }
  }

  async function handleSyncConnection(connection: ProviderConnectionSummary) {
    if (connection.status !== "active") {
      toast.error("Reconnect this provider before syncing.");
      return;
    }
    try {
      const result = await syncProviderConnections.mutateAsync({
        connectionId: connection.id,
      });
      successToast(summarizeProviderSync(result.data ?? []));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to sync provider",
      );
    }
  }

  async function handleDisconnectProvider() {
    if (!disconnectTarget) return;
    setDisconnectingProvider(true);
    try {
      await disconnectProviderConnection.mutateAsync(disconnectTarget.id);
      successToast("Provider disconnected");
      setDisconnectTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to disconnect provider",
      );
    } finally {
      setDisconnectingProvider(false);
    }
  }

  async function updateAccountColor(
    account: AccountWithBalance,
    nextColor: string | null,
  ) {
    await execute({
      id: crypto.randomUUID(),
      label: "Update account",
      apply: async () => {
        await updateAccount.mutateAsync({ id: account.id, color: nextColor });
      },
      undo: async () => {
        await updateAccount.mutateAsync({
          id: account.id,
          name: account.name,
          type: account.type,
          initial_balance: account.initial_balance,
          color: account.color,
        });
      },
      redo: async () => {
        await updateAccount.mutateAsync({ id: account.id, color: nextColor });
      },
    });
  }

  async function handleReconcileSubmit(data: {
    date: string;
    target_balance: number;
    name?: string;
  }) {
    if (!reconcileTarget) return;
    const result = await reconcileAccount.mutateAsync({
      id: reconcileTarget.id,
      ...data,
    });
    const adjustment = result.data?.adjustment_amount ?? 0;
    const transactionId = result.data?.transaction?.id ?? null;
    if (adjustment === 0) {
      successToast("Account already matches that value");
    } else {
      successToast(`Adjustment created: ${formatCurrency(adjustment)}`);
    }
    setReconcileTarget(null);
    if (!transactionId) return;

    await execute({
      id: crypto.randomUUID(),
      label: "Reconcile account",
      apply: () => undefined,
      undo: async () => {
        await deleteTransaction.mutateAsync(transactionId);
      },
      redo: async () => {
        await restoreTransaction.mutateAsync(transactionId);
      },
    });
  }

  function startEdit(a: AccountWithBalance) {
    setEditId(a.id);
    setEditName(a.name);
    setEditType(a.type);
    setEditInitialBalance(String(a.initial_balance));
    setEditColor(a.color);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAllSelected() {
    setSelectedIds((current) => {
      if (allSelected) {
        const next = new Set(current);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...current, ...selectableIds]);
    });
  }

  const cancelAccountForm = useCallback(() => {
    setShowAdd(false);
    setEditId(null);
  }, []);

  useShortcut(
    "setup.accounts.add",
    useCallback(() => setShowAdd(true), []),
  );
  useShortcut("setup.accounts.save", () => {
    if (showAdd) {
      void submitAddAccount();
    } else if (editId) {
      void handleUpdate(editId);
    }
  });

  function handleAccountEditRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    accountId: string,
  ) {
    if (saving) return;
    handleEnterSave(event, () => {
      void handleUpdate(accountId);
    });
  }
  useShortcut("setup.accounts.cancel", cancelAccountForm, {
    enabled: showAdd || editId !== null,
  });
  useShortcut(
    "setup.accounts.editFocused",
    useCallback(() => {
      if (focusedAccount) startEdit(focusedAccount);
    }, [focusedAccount]),
  );
  useShortcut(
    "setup.accounts.deleteFocused",
    useCallback(() => {
      if (focusedAccount) setDeleteTarget(focusedAccount);
    }, [focusedAccount]),
  );
  useShortcut(
    "setup.accounts.bulkDelete",
    useCallback(() => setShowBulkDelete(true), []),
    { enabled: selectedCount > 0 },
  );
  useShortcut("setup.accounts.selectAll", toggleAllSelected);
  useShortcut(
    "setup.accounts.toggleFocused",
    useCallback(() => {
      if (focusedAccount) toggleSelected(focusedAccount.id);
    }, [focusedAccount]),
  );
  useShortcut(
    "setup.accounts.sortName",
    useCallback(() => setSort((current) => nextSort(current, "name")), []),
  );
  useShortcut(
    "setup.accounts.sortType",
    useCallback(() => setSort((current) => nextSort(current, "type")), []),
  );
  useShortcut(
    "setup.accounts.sortBalance",
    useCallback(() => setSort((current) => nextSort(current, "balance")), []),
  );

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div
      onFocus={() => setSectionFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setSectionFocused(false);
        }
      }}
    >
      {selectedCount > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {selectedCount} account{selectedCount === 1 ? "" : "s"} selected
          </span>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-7"
            onClick={() => setShowBulkDelete(true)}
          >
            <Trash2 size={14} className="mr-1" /> Delete Selected
            <ShortcutHint commandId="setup.accounts.bulkDelete" />
          </Button>
        </div>
      )}
      <Card className="mb-4">
        <CardHeader className="mb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Linked Providers</CardTitle>
              <p className="text-sm text-muted-foreground">
                Connect read-only Plaid or Akoya accounts, then sync manually
                when you want LocalFin to import provider transactions.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <PlaidConnectButton
                targetInstitution="us_bank"
                label="Connect US Bank (Plaid)"
                createLinkToken={createPlaidLinkToken.mutateAsync}
                exchangePublicToken={exchangePlaidPublicToken.mutateAsync}
                loading={
                  createPlaidLinkToken.isPending ||
                  exchangePlaidPublicToken.isPending
                }
              />
              <PlaidConnectButton
                targetInstitution="discover"
                label="Connect Discover (Plaid)"
                createLinkToken={createPlaidLinkToken.mutateAsync}
                exchangePublicToken={exchangePlaidPublicToken.mutateAsync}
                loading={
                  createPlaidLinkToken.isPending ||
                  exchangePlaidPublicToken.isPending
                }
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleStartAkoyaAuthorization}
                loading={startAkoyaAuthorization.isPending}
              >
                Connect Fidelity (Akoya)
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {providerConnectionsLoading ? (
            <p className="text-sm text-muted-foreground">
              Loading linked providers...
            </p>
          ) : connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No linked providers yet.
            </p>
          ) : (
            <div className="space-y-3">
              {connections.map((connection) => (
                <div
                  key={connection.id}
                  className="rounded-md border border-border bg-background/60 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-medium text-foreground">
                          {connection.institution_name}
                        </h4>
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                          {formatProviderName(connection.provider)}
                        </span>
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                          {formatConnectionStatus(connection.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Last sync: {formatDateTime(connection.last_sync_at)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSyncConnection(connection)}
                        loading={syncProviderConnections.isPending}
                        disabled={connection.status !== "active"}
                        title={
                          connection.status === "active"
                            ? "Sync now"
                            : "Reconnect this provider before syncing"
                        }
                      >
                        Sync now
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => setDisconnectTarget(connection)}
                      >
                        Disconnect
                      </Button>
                    </div>
                  </div>

                  {connection.accounts.length > 0 ? (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {connection.accounts.map((account) => (
                        <div
                          key={account.id}
                          className="rounded border border-border/70 px-2 py-1.5 text-sm"
                        >
                          <div className="flex justify-between gap-2">
                            <span className="truncate">
                              {account.name}
                              {account.mask ? ` •${account.mask}` : ""}
                            </span>
                            <span className="font-mono">
                              {account.current_balance == null
                                ? "—"
                                : formatCurrency(account.current_balance)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {account.provider_subtype ||
                              account.provider_type ||
                              account.type}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      No provider accounts linked yet.
                    </p>
                  )}

                  {connection.last_error && (
                    <p className="mt-3 rounded border border-red-900/60 bg-red-950/30 px-2 py-1.5 text-sm text-red-300">
                      {connection.last_error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <div className="overflow-x-auto">
        <table
          className="w-full text-sm"
          style={{ minWidth: totalWidth, tableLayout: "fixed" }}
        >
          <colgroup>
            {columns.map((column) => (
              <col key={column.id} style={getColStyle(column.id)} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("select")}
              >
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={selectableIds.length === 0}
                  onChange={toggleAllSelected}
                  aria-label="Select all accounts"
                  className="h-4 w-4 rounded border-border bg-background"
                />
                <span
                  {...getResizeHandleProps("select")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("name")}
              >
                <SortHeader
                  label="Name"
                  sortKey="name"
                  sort={sort}
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                />
                <span
                  {...getResizeHandleProps("name")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("type")}
              >
                <SortHeader
                  label="Type"
                  sortKey="type"
                  sort={sort}
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                />
                <span
                  {...getResizeHandleProps("type")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("color")}
              >
                Color
                <span
                  {...getResizeHandleProps("color")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 text-right font-medium"
                style={getHeaderStyle("initialBalance")}
              >
                Initial Balance
                <span
                  {...getResizeHandleProps("initialBalance")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 text-right font-medium"
                style={getHeaderStyle("balance")}
              >
                <SortHeader
                  label="Balance"
                  sortKey="balance"
                  sort={sort}
                  align="right"
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                />
                <span
                  {...getResizeHandleProps("balance")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 text-right font-medium"
                style={getHeaderStyle("actions")}
              >
                Actions
                <span
                  {...getResizeHandleProps("actions")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedAccounts.map((a) => (
              <tr
                key={a.id}
                tabIndex={0}
                onFocus={() => setFocusedId(a.id)}
                onKeyDown={
                  editId === a.id
                    ? (event) => handleAccountEditRowKeyDown(event, a.id)
                    : undefined
                }
                className={`border-b border-border/50 outline-none focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring ${
                  focusedId === a.id ? "bg-secondary/20" : ""
                }`}
              >
                {editId === a.id ? (
                  <>
                    <td className="py-1.5" />
                    <td className="py-1.5 pr-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-7 text-sm"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <SimpleSelect
                        value={editType}
                        onChange={(e) =>
                          setEditType(e.target.value as "asset" | "liability")
                        }
                        options={[
                          { value: "asset", label: "Asset" },
                          { value: "liability", label: "Liability" },
                        ]}
                        className="h-7 text-sm"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <ColorPicker
                        value={editColor}
                        onChange={setEditColor}
                        label={`${a.name} color`}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        type="number"
                        step="0.01"
                        value={editInitialBalance}
                        onChange={(e) => setEditInitialBalance(e.target.value)}
                        className="h-7 text-right text-sm"
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      {formatCurrency(a.current_balance)}
                    </td>
                    <td className="py-1.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => handleUpdate(a.id)}
                          loading={saving}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => setEditId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-1.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(a.id)}
                        onChange={() => toggleSelected(a.id)}
                        aria-label={`Select ${a.name}`}
                        className="h-4 w-4 rounded border-border bg-background"
                      />
                    </td>
                    <td className="py-1.5">
                      <EntityLabel id={a.id} name={a.name} color={a.color} />
                    </td>
                    <td className="py-1.5">
                      <TypeBadge type={a.type} />
                    </td>
                    <td className="py-1.5">
                      <ColorPicker
                        value={a.color}
                        onChange={(nextColor) => {
                          void updateAccountColor(a, nextColor);
                        }}
                        label={`${a.name} color`}
                      />
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      {formatCurrency(a.initial_balance)}
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      {formatCurrency(a.current_balance)}
                    </td>
                    <td className="py-1.5 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setReconcileTarget(a)}
                          className="p-1 text-muted-foreground hover:text-foreground"
                          title="Update current value"
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(a)}
                          className="p-1 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(a)}
                          className="p-1 text-muted-foreground hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add form */}
      {showAdd ? (
        <form onSubmit={handleAdd} className="mt-3 flex items-end gap-2">
          <Input
            placeholder="Account name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
          />
          <SimpleSelect
            value={type}
            onChange={(e) => setType(e.target.value as "asset" | "liability")}
            options={[
              { value: "asset", label: "Asset" },
              { value: "liability", label: "Liability" },
            ]}
            className="h-8 w-36 text-sm"
          />
          <Input
            placeholder="Initial balance"
            type="number"
            step="0.01"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            className="h-8 w-36 text-sm"
          />
          <ColorPicker
            value={color}
            onChange={setColor}
            label="New account color"
          />
          <Button type="submit" size="sm" className="h-8" loading={saving}>
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => setShowAdd(false)}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() => setShowAdd(true)}
        >
          <Plus size={14} className="mr-1" /> Add Account
          <ShortcutHint commandId="setup.accounts.add" />
        </Button>
      )}

      {/* Delete modal */}
      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Account"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        isLoading={deleting}
      />
      <ConfirmDeleteModal
        isOpen={!!disconnectTarget}
        onClose={() => setDisconnectTarget(null)}
        onConfirm={handleDisconnectProvider}
        title="Disconnect Provider"
        message={`Disconnect ${disconnectTarget?.institution_name ?? "provider"}? Local accounts and imported transactions will remain, but LocalFin will stop syncing this provider connection.`}
        isLoading={disconnectingProvider}
      />
      {reconcileTarget && (
        <ReconcileAccountModal
          account={reconcileTarget}
          onClose={() => setReconcileTarget(null)}
          onSubmit={handleReconcileSubmit}
          isLoading={reconcileAccount.isPending}
        />
      )}
      <ConfirmDeleteModal
        isOpen={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        onConfirm={handleBulkDelete}
        title="Delete Accounts"
        message={`Delete ${selectedCount} selected account${selectedCount === 1 ? "" : "s"}? This cannot be undone.`}
        isLoading={deleting}
      />
    </div>
  );
}

function ReconcileAccountModal({
  account,
  onClose,
  onSubmit,
  isLoading,
}: {
  account: AccountWithBalance;
  onClose: () => void;
  onSubmit: (data: { date: string; target_balance: number }) => Promise<void>;
  isLoading: boolean;
}) {
  const [targetBalance, setTargetBalance] = useState(() =>
    account.current_balance.toFixed(2),
  );
  const [date, setDate] = useState(() => todayIsoDate());

  const targetValue = targetBalance.trim() ? Number(targetBalance) : NaN;
  const delta =
    account && Number.isFinite(targetValue)
      ? Math.round((targetValue - account.current_balance) * 100) / 100
      : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!Number.isFinite(targetValue)) {
      toast.error("Enter a valid target value");
      return;
    }
    await onSubmit({ date, target_balance: targetValue });
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Update Current Value"
      description={account.name}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Current balance</span>
            <span className="font-mono">
              {formatCurrency(account.current_balance)}
            </span>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <span className="text-muted-foreground">Adjustment</span>
            <span
              className={`font-mono ${delta == null || delta >= 0 ? "text-green-400" : "text-red-400"}`}
            >
              {delta == null ? "-" : formatCurrency(delta)}
            </span>
          </div>
        </div>
        <Input
          label="Target value"
          type="number"
          step="0.01"
          value={targetBalance}
          onChange={(event) => setTargetBalance(event.target.value)}
          required
        />
        <Input
          label="As of date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button type="submit" loading={isLoading}>
            Save Adjustment
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Categories Section ───────────────────────────────────

function CategoriesSection() {
  const {
    categories,
    isLoading,
    createCategory,
    updateCategory,
    deleteCategory,
    restoreCategory,
  } = useCategories();
  const successToast = useSuccessToast();
  const { execute } = useUndoRedo();
  type CategorySortKey = "name" | "type";

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"income" | "expense">("expense");
  const [color, setColor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<"income" | "expense">("expense");
  const [editColor, setEditColor] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [sectionFocused, setSectionFocused] = useState(false);
  const [sort, setSort] = useState<SortConfig<CategorySortKey>>({
    key: "name",
    direction: "asc",
  });
  const {
    columns,
    totalWidth,
    getColStyle,
    getHeaderStyle,
    getResizeHandleProps,
  } = useResizableColumns("setup.categories", SETUP_CATEGORY_COLUMN_DEFS);

  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => {
      const result =
        sort.key === "name"
          ? compareText(a.name, b.name)
          : compareText(a.type, b.type);
      return applySortDirection(result, sort.direction);
    });
  }, [categories, sort]);

  const selectableIds = useMemo(
    () => sortedCategories.filter((c) => !c.is_system).map((c) => c.id),
    [sortedCategories],
  );
  const selectedCount = selectedIds.size;
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedIds.has(id));
  const focusedCategory =
    sortedCategories.find((category) => category.id === focusedId) ??
    sortedCategories.find((category) => !category.is_system) ??
    null;

  useShortcutScope(
    "setupCategories",
    sectionFocused || showAdd || editId !== null,
  );

  async function submitAddCategory() {
    if (!name.trim()) return;
    const payload = { name: name.trim(), type, color };
    let createdId: string | null = null;
    setSaving(true);
    try {
      await execute({
        id: crypto.randomUUID(),
        label: "Create category",
        apply: async () => {
          try {
            const result = await createCategory.mutateAsync(payload);
            createdId = result.data?.id ?? null;
            if (!createdId)
              throw new Error("Category creation returned no category.");
            successToast("Category created");
            setName("");
            setColor(null);
            setType("expense");
            setShowAdd(false);
          } catch {
            toast.error("Failed to create category");
            throw new Error("Failed to create category");
          }
        },
        undo: async () => {
          if (createdId) await deleteCategory.mutateAsync(createdId);
        },
        redo: async () => {
          if (createdId) await restoreCategory.mutateAsync(createdId);
        },
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    await submitAddCategory();
  }

  async function handleUpdate(id: string) {
    if (!editName.trim()) return;
    const before = categories.find((category) => category.id === id);
    const updates = { name: editName.trim(), type: editType, color: editColor };
    setSaving(true);
    try {
      if (!before) {
        await updateCategory.mutateAsync({ id, ...updates });
      } else {
        const applied = await execute({
          id: crypto.randomUUID(),
          label: "Update category",
          apply: async () => {
            await updateCategory.mutateAsync({ id, ...updates });
          },
          undo: async () => {
            await updateCategory.mutateAsync({
              id,
              name: before.name,
              type: before.type,
              color: before.color,
            });
          },
          redo: async () => {
            await updateCategory.mutateAsync({ id, ...updates });
          },
        });
        if (!applied) throw new Error("Failed to update category");
      }
      successToast("Category updated");
      setEditId(null);
    } catch {
      toast.error("Failed to update category");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    try {
      const applied = await execute({
        id: crypto.randomUUID(),
        label: "Delete category",
        apply: async () => {
          await deleteCategory.mutateAsync(target.id);
        },
        undo: async () => {
          await restoreCategory.mutateAsync(target.id);
        },
        redo: async () => {
          await deleteCategory.mutateAsync(target.id);
        },
      });
      if (!applied) throw new Error("Failed to delete category");
      successToast("Category deleted");
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
      setDeleteTarget(null);
    } catch {
      toast.error("Failed to delete category");
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const ids = sortedCategories
      .filter((category) => selectedIds.has(category.id) && !category.is_system)
      .map((category) => category.id);
    try {
      const applied = await execute({
        id: crypto.randomUUID(),
        label: "Delete categories",
        apply: async () => {
          for (const id of ids) {
            await deleteCategory.mutateAsync(id);
          }
        },
        undo: async () => {
          for (const id of ids) {
            await restoreCategory.mutateAsync(id);
          }
        },
        redo: async () => {
          for (const id of ids) {
            await deleteCategory.mutateAsync(id);
          }
        },
      });
      if (!applied) throw new Error("Failed to delete selected categories");
      setSelectedIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      successToast(`${ids.length} categories deleted`);
      setShowBulkDelete(false);
    } catch {
      toast.error("Failed to delete selected categories");
    } finally {
      setDeleting(false);
    }
  }

  function startEdit(c: Category) {
    setEditId(c.id);
    setEditName(c.name);
    setEditType(c.type);
    setEditColor(c.color);
  }

  async function updateCategoryColor(
    category: Category,
    nextColor: string | null,
  ) {
    await execute({
      id: crypto.randomUUID(),
      label: "Update category",
      apply: async () => {
        await updateCategory.mutateAsync({ id: category.id, color: nextColor });
      },
      undo: async () => {
        await updateCategory.mutateAsync({
          id: category.id,
          name: category.name,
          type: category.type,
          color: category.color,
        });
      },
      redo: async () => {
        await updateCategory.mutateAsync({ id: category.id, color: nextColor });
      },
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAllSelected() {
    setSelectedIds((current) => {
      if (allSelected) {
        const next = new Set(current);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...current, ...selectableIds]);
    });
  }

  const cancelCategoryForm = useCallback(() => {
    setShowAdd(false);
    setEditId(null);
  }, []);

  useShortcut(
    "setup.categories.add",
    useCallback(() => setShowAdd(true), []),
  );
  useShortcut("setup.categories.save", () => {
    if (showAdd) {
      void submitAddCategory();
    } else if (editId) {
      void handleUpdate(editId);
    }
  });

  function handleCategoryEditRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    categoryId: string,
  ) {
    if (saving) return;
    handleEnterSave(event, () => {
      void handleUpdate(categoryId);
    });
  }
  useShortcut("setup.categories.cancel", cancelCategoryForm, {
    enabled: showAdd || editId !== null,
  });
  useShortcut(
    "setup.categories.editFocused",
    useCallback(() => {
      if (focusedCategory && !focusedCategory.is_system)
        startEdit(focusedCategory);
    }, [focusedCategory]),
  );
  useShortcut(
    "setup.categories.deleteFocused",
    useCallback(() => {
      if (focusedCategory && !focusedCategory.is_system)
        setDeleteTarget(focusedCategory);
    }, [focusedCategory]),
  );
  useShortcut(
    "setup.categories.bulkDelete",
    useCallback(() => setShowBulkDelete(true), []),
    { enabled: selectedCount > 0 },
  );
  useShortcut("setup.categories.selectAll", toggleAllSelected);
  useShortcut(
    "setup.categories.toggleFocused",
    useCallback(() => {
      if (focusedCategory && !focusedCategory.is_system)
        toggleSelected(focusedCategory.id);
    }, [focusedCategory]),
  );
  useShortcut(
    "setup.categories.sortName",
    useCallback(() => setSort((current) => nextSort(current, "name")), []),
  );
  useShortcut(
    "setup.categories.sortType",
    useCallback(() => setSort((current) => nextSort(current, "type")), []),
  );

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div
      onFocus={() => setSectionFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setSectionFocused(false);
        }
      }}
    >
      {selectedCount > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {selectedCount} categor{selectedCount === 1 ? "y" : "ies"} selected
          </span>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-7"
            onClick={() => setShowBulkDelete(true)}
          >
            <Trash2 size={14} className="mr-1" /> Delete Selected
            <ShortcutHint commandId="setup.categories.bulkDelete" />
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table
          className="w-full text-sm"
          style={{ minWidth: totalWidth, tableLayout: "fixed" }}
        >
          <colgroup>
            {columns.map((column) => (
              <col key={column.id} style={getColStyle(column.id)} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("select")}
              >
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={selectableIds.length === 0}
                  onChange={toggleAllSelected}
                  aria-label="Select all categories"
                  className="h-4 w-4 rounded border-border bg-background"
                />
                <span
                  {...getResizeHandleProps("select")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("name")}
              >
                <SortHeader
                  label="Name"
                  sortKey="name"
                  sort={sort}
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                />
                <span
                  {...getResizeHandleProps("name")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("type")}
              >
                <SortHeader
                  label="Type"
                  sortKey="type"
                  sort={sort}
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                />
                <span
                  {...getResizeHandleProps("type")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("color")}
              >
                Color
                <span
                  {...getResizeHandleProps("color")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 text-right font-medium"
                style={getHeaderStyle("actions")}
              >
                Actions
                <span
                  {...getResizeHandleProps("actions")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedCategories.map((c) => (
              <tr
                key={c.id}
                tabIndex={0}
                onKeyDown={
                  editId === c.id
                    ? (event) => handleCategoryEditRowKeyDown(event, c.id)
                    : undefined
                }
                onFocus={() => setFocusedId(c.id)}
                className={`border-b border-border/50 outline-none focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring ${
                  focusedId === c.id ? "bg-secondary/20" : ""
                }`}
              >
                {editId === c.id ? (
                  <>
                    <td className="py-1.5" />
                    <td className="py-1.5 pr-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-7 text-sm"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <SimpleSelect
                        value={editType}
                        onChange={(e) =>
                          setEditType(e.target.value as "income" | "expense")
                        }
                        options={[
                          { value: "income", label: "Income" },
                          { value: "expense", label: "Expense" },
                        ]}
                        className="h-7 text-sm"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <ColorPicker
                        value={editColor}
                        onChange={setEditColor}
                        label={`${c.name} color`}
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => handleUpdate(c.id)}
                          loading={saving}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => setEditId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-1.5">
                      {!c.is_system && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleSelected(c.id)}
                          aria-label={`Select ${c.name}`}
                          className="h-4 w-4 rounded border-border bg-background"
                        />
                      )}
                    </td>
                    <td className="py-1.5">
                      <EntityLabel id={c.id} name={c.name} color={c.color} />
                      {c.is_system && (
                        <Lock
                          size={12}
                          className="ml-1.5 inline text-muted-foreground"
                        />
                      )}
                    </td>
                    <td className="py-1.5">
                      <TypeBadge type={c.type} />
                    </td>
                    <td className="py-1.5">
                      <ColorPicker
                        value={c.color}
                        onChange={(nextColor) => {
                          void updateCategoryColor(c, nextColor);
                        }}
                        label={`${c.name} color`}
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      {!c.is_system && (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(c)}
                            className="p-1 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(c)}
                            className="p-1 text-muted-foreground hover:text-red-400"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd ? (
        <form onSubmit={handleAdd} className="mt-3 flex items-end gap-2">
          <Input
            placeholder="Category name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
          />
          <SimpleSelect
            value={type}
            onChange={(e) => setType(e.target.value as "income" | "expense")}
            options={[
              { value: "income", label: "Income" },
              { value: "expense", label: "Expense" },
            ]}
            className="h-8 w-36 text-sm"
          />
          <ColorPicker
            value={color}
            onChange={setColor}
            label="New category color"
          />
          <Button type="submit" size="sm" className="h-8" loading={saving}>
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => setShowAdd(false)}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() => setShowAdd(true)}
        >
          <Plus size={14} className="mr-1" /> Add Category
          <ShortcutHint commandId="setup.categories.add" />
        </Button>
      )}

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Category"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? All subcategories under it will also be removed.`}
        isLoading={deleting}
      />
      <ConfirmDeleteModal
        isOpen={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        onConfirm={handleBulkDelete}
        title="Delete Categories"
        message={`Delete ${selectedCount} selected categor${selectedCount === 1 ? "y" : "ies"}? All subcategories under them will also be removed.`}
        isLoading={deleting}
      />
    </div>
  );
}

// ─── Subcategories Section ────────────────────────────────

function SubcategoriesSection() {
  const {
    categories,
    subcategories,
    isLoading,
    createSubcategory,
    updateSubcategory,
    deleteSubcategory,
    restoreSubcategory,
  } = useCategories();
  const successToast = useSuccessToast();
  const { execute } = useUndoRedo();
  type SubcategorySortKey = "name" | "category" | "monthlyGoal";

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [goal, setGoal] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editGoal, setEditGoal] = useState("");
  const [editColor, setEditColor] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Subcategory | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [sectionFocused, setSectionFocused] = useState(false);
  const [sort, setSort] = useState<SortConfig<SubcategorySortKey>>({
    key: "name",
    direction: "asc",
  });
  const {
    columns,
    totalWidth,
    getColStyle,
    getHeaderStyle,
    getResizeHandleProps,
  } = useResizableColumns("setup.subcategories", SETUP_SUBCATEGORY_COLUMN_DEFS);

  const categoryOptions = categories.map((c) => ({
    value: c.id,
    label: `${c.name} (${c.type})`,
  }));

  const sortedSubcategories = useMemo(() => {
    return [...subcategories].sort((a, b) => {
      const categoryA = categoryMap.get(a.category_id);
      const categoryB = categoryMap.get(b.category_id);
      let result = 0;

      if (sort.key === "name") {
        result = compareText(a.name, b.name);
      } else if (sort.key === "category") {
        result = compareText(categoryA?.name ?? "", categoryB?.name ?? "");
      } else {
        const goalA = a.monthly_goal ?? Number.POSITIVE_INFINITY;
        const goalB = b.monthly_goal ?? Number.POSITIVE_INFINITY;
        result = goalA - goalB;
      }

      return applySortDirection(result, sort.direction);
    });
  }, [categoryMap, sort, subcategories]);

  const selectableIds = useMemo(
    () => sortedSubcategories.filter((s) => !s.is_system).map((s) => s.id),
    [sortedSubcategories],
  );
  const selectedCount = selectedIds.size;
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedIds.has(id));
  const focusedSubcategory =
    sortedSubcategories.find((subcategory) => subcategory.id === focusedId) ??
    sortedSubcategories.find((subcategory) => !subcategory.is_system) ??
    null;

  useShortcutScope(
    "setupSubcategories",
    sectionFocused || showAdd || editId !== null,
  );

  async function submitAddSubcategory() {
    if (!name.trim() || !categoryId) return;
    const payload = {
      name: name.trim(),
      category_id: categoryId,
      monthly_goal: goal ? parseFloat(goal) : null,
      color,
    };
    let createdId: string | null = null;
    setSaving(true);
    try {
      await execute({
        id: crypto.randomUUID(),
        label: "Create subcategory",
        apply: async () => {
          try {
            const result = await createSubcategory.mutateAsync(payload);
            createdId = result.data?.id ?? null;
            if (!createdId) {
              throw new Error("Subcategory creation returned no subcategory.");
            }
            successToast("Subcategory created");
            setName("");
            setCategoryId("");
            setGoal("");
            setColor(null);
            setShowAdd(false);
          } catch {
            toast.error("Failed to create subcategory");
            throw new Error("Failed to create subcategory");
          }
        },
        undo: async () => {
          if (createdId) await deleteSubcategory.mutateAsync(createdId);
        },
        redo: async () => {
          if (createdId) await restoreSubcategory.mutateAsync(createdId);
        },
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    await submitAddSubcategory();
  }

  async function handleUpdate(id: string) {
    if (!editName.trim() || !editCategoryId) return;
    const before = subcategories.find((subcategory) => subcategory.id === id);
    const updates = {
      name: editName.trim(),
      category_id: editCategoryId,
      monthly_goal: editGoal ? parseFloat(editGoal) : null,
      color: editColor,
    };
    setSaving(true);
    try {
      if (!before) {
        await updateSubcategory.mutateAsync({ id, ...updates });
      } else {
        const applied = await execute({
          id: crypto.randomUUID(),
          label: "Update subcategory",
          apply: async () => {
            await updateSubcategory.mutateAsync({ id, ...updates });
          },
          undo: async () => {
            await updateSubcategory.mutateAsync({
              id,
              name: before.name,
              category_id: before.category_id,
              monthly_goal: before.monthly_goal,
              color: before.color,
            });
          },
          redo: async () => {
            await updateSubcategory.mutateAsync({ id, ...updates });
          },
        });
        if (!applied) throw new Error("Failed to update subcategory");
      }
      successToast("Subcategory updated");
      setEditId(null);
    } catch {
      toast.error("Failed to update subcategory");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    try {
      const applied = await execute({
        id: crypto.randomUUID(),
        label: "Delete subcategory",
        apply: async () => {
          await deleteSubcategory.mutateAsync(target.id);
        },
        undo: async () => {
          await restoreSubcategory.mutateAsync(target.id);
        },
        redo: async () => {
          await deleteSubcategory.mutateAsync(target.id);
        },
      });
      if (!applied) throw new Error("Failed to delete subcategory");
      successToast("Subcategory deleted");
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
      setDeleteTarget(null);
    } catch {
      toast.error("Failed to delete subcategory");
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const ids = sortedSubcategories
      .filter(
        (subcategory) =>
          selectedIds.has(subcategory.id) && !subcategory.is_system,
      )
      .map((subcategory) => subcategory.id);
    try {
      const applied = await execute({
        id: crypto.randomUUID(),
        label: "Delete subcategories",
        apply: async () => {
          for (const id of ids) {
            await deleteSubcategory.mutateAsync(id);
          }
        },
        undo: async () => {
          for (const id of ids) {
            await restoreSubcategory.mutateAsync(id);
          }
        },
        redo: async () => {
          for (const id of ids) {
            await deleteSubcategory.mutateAsync(id);
          }
        },
      });
      if (!applied) throw new Error("Failed to delete selected subcategories");
      setSelectedIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      successToast(`${ids.length} subcategories deleted`);
      setShowBulkDelete(false);
    } catch {
      toast.error("Failed to delete selected subcategories");
    } finally {
      setDeleting(false);
    }
  }

  function startEdit(s: Subcategory) {
    setEditId(s.id);
    setEditName(s.name);
    setEditCategoryId(s.category_id);
    setEditGoal(s.monthly_goal != null ? String(s.monthly_goal) : "");
    setEditColor(s.color);
  }

  async function updateSubcategoryColor(
    subcategory: Subcategory,
    nextColor: string | null,
  ) {
    await execute({
      id: crypto.randomUUID(),
      label: "Update subcategory",
      apply: async () => {
        await updateSubcategory.mutateAsync({
          id: subcategory.id,
          color: nextColor,
        });
      },
      undo: async () => {
        await updateSubcategory.mutateAsync({
          id: subcategory.id,
          name: subcategory.name,
          category_id: subcategory.category_id,
          monthly_goal: subcategory.monthly_goal,
          color: subcategory.color,
        });
      },
      redo: async () => {
        await updateSubcategory.mutateAsync({
          id: subcategory.id,
          color: nextColor,
        });
      },
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAllSelected() {
    setSelectedIds((current) => {
      if (allSelected) {
        const next = new Set(current);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...current, ...selectableIds]);
    });
  }

  const cancelSubcategoryForm = useCallback(() => {
    setShowAdd(false);
    setEditId(null);
  }, []);

  useShortcut(
    "setup.subcategories.add",
    useCallback(() => setShowAdd(true), []),
  );
  useShortcut("setup.subcategories.save", () => {
    if (showAdd) {
      void submitAddSubcategory();
    } else if (editId) {
      void handleUpdate(editId);
    }
  });

  function handleSubcategoryEditRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    subcategoryId: string,
  ) {
    if (saving) return;
    handleEnterSave(event, () => {
      void handleUpdate(subcategoryId);
    });
  }
  useShortcut("setup.subcategories.cancel", cancelSubcategoryForm, {
    enabled: showAdd || editId !== null,
  });
  useShortcut(
    "setup.subcategories.editFocused",
    useCallback(() => {
      if (focusedSubcategory && !focusedSubcategory.is_system)
        startEdit(focusedSubcategory);
    }, [focusedSubcategory]),
  );
  useShortcut(
    "setup.subcategories.deleteFocused",
    useCallback(() => {
      if (focusedSubcategory && !focusedSubcategory.is_system)
        setDeleteTarget(focusedSubcategory);
    }, [focusedSubcategory]),
  );
  useShortcut(
    "setup.subcategories.bulkDelete",
    useCallback(() => setShowBulkDelete(true), []),
    { enabled: selectedCount > 0 },
  );
  useShortcut("setup.subcategories.selectAll", toggleAllSelected);
  useShortcut(
    "setup.subcategories.toggleFocused",
    useCallback(() => {
      if (focusedSubcategory && !focusedSubcategory.is_system)
        toggleSelected(focusedSubcategory.id);
    }, [focusedSubcategory]),
  );
  useShortcut(
    "setup.subcategories.sortName",
    useCallback(() => setSort((current) => nextSort(current, "name")), []),
  );
  useShortcut(
    "setup.subcategories.sortCategory",
    useCallback(() => setSort((current) => nextSort(current, "category")), []),
  );
  useShortcut(
    "setup.subcategories.sortGoal",
    useCallback(
      () => setSort((current) => nextSort(current, "monthlyGoal")),
      [],
    ),
  );

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div
      onFocus={() => setSectionFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setSectionFocused(false);
        }
      }}
    >
      {selectedCount > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {selectedCount} subcategor{selectedCount === 1 ? "y" : "ies"}{" "}
            selected
          </span>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-7"
            onClick={() => setShowBulkDelete(true)}
          >
            <Trash2 size={14} className="mr-1" /> Delete Selected
            <ShortcutHint commandId="setup.subcategories.bulkDelete" />
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table
          className="w-full text-sm"
          style={{ minWidth: totalWidth, tableLayout: "fixed" }}
        >
          <colgroup>
            {columns.map((column) => (
              <col key={column.id} style={getColStyle(column.id)} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("select")}
              >
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={selectableIds.length === 0}
                  onChange={toggleAllSelected}
                  aria-label="Select all subcategories"
                  className="h-4 w-4 rounded border-border bg-background"
                />
                <span
                  {...getResizeHandleProps("select")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("name")}
              >
                <SortHeader
                  label="Name"
                  sortKey="name"
                  sort={sort}
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                />
                <span
                  {...getResizeHandleProps("name")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("category")}
              >
                <SortHeader
                  label="Category"
                  sortKey="category"
                  sort={sort}
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                />
                <span
                  {...getResizeHandleProps("category")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 text-right font-medium"
                style={getHeaderStyle("monthlyGoal")}
              >
                <SortHeader
                  label="Monthly Goal"
                  sortKey="monthlyGoal"
                  sort={sort}
                  align="right"
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                />
                <span
                  {...getResizeHandleProps("monthlyGoal")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 font-medium"
                style={getHeaderStyle("color")}
              >
                Color
                <span
                  {...getResizeHandleProps("color")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
              <th
                className="relative pb-1 text-right font-medium"
                style={getHeaderStyle("actions")}
              >
                Actions
                <span
                  {...getResizeHandleProps("actions")}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedSubcategories.map((s) => {
              const parentCat = categoryMap.get(s.category_id);
              return (
                <tr
                  key={s.id}
                  tabIndex={0}
                  onFocus={() => setFocusedId(s.id)}
                  onKeyDown={
                    editId === s.id
                      ? (event) => handleSubcategoryEditRowKeyDown(event, s.id)
                      : undefined
                  }
                  className={`border-b border-border/50 outline-none focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring ${
                    focusedId === s.id ? "bg-secondary/20" : ""
                  }`}
                >
                  {editId === s.id ? (
                    <>
                      <td className="py-1.5" />
                      <td className="py-1.5 pr-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-7 text-sm"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <SimpleSelect
                          value={editCategoryId}
                          onChange={(e) => setEditCategoryId(e.target.value)}
                          options={categoryOptions}
                          className="h-7 text-sm"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="None"
                          value={editGoal}
                          onChange={(e) => setEditGoal(e.target.value)}
                          className="h-7 text-right text-sm"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <ColorPicker
                          value={editColor}
                          onChange={setEditColor}
                          label={`${s.name} color`}
                        />
                      </td>
                      <td className="py-1.5 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => handleUpdate(s.id)}
                            loading={saving}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            onClick={() => setEditId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-1.5">
                        {!s.is_system && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(s.id)}
                            onChange={() => toggleSelected(s.id)}
                            aria-label={`Select ${s.name}`}
                            className="h-4 w-4 rounded border-border bg-background"
                          />
                        )}
                      </td>
                      <td className="py-1.5">
                        <EntityLabel id={s.id} name={s.name} color={s.color} />
                        {s.is_system && (
                          <Lock
                            size={12}
                            className="ml-1.5 inline text-muted-foreground"
                          />
                        )}
                      </td>
                      <td className="py-1.5">
                        {parentCat ? (
                          <>
                            <EntityLabel
                              id={parentCat.id}
                              name={parentCat.name}
                              color={parentCat.color}
                            />{" "}
                            <TypeBadge type={parentCat.type} />
                          </>
                        ) : (
                          <span className="text-muted-foreground">Unknown</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono">
                        {s.monthly_goal != null ? (
                          formatCurrency(s.monthly_goal)
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </td>
                      <td className="py-1.5">
                        <ColorPicker
                          value={s.color}
                          onChange={(nextColor) => {
                            void updateSubcategoryColor(s, nextColor);
                          }}
                          label={`${s.name} color`}
                        />
                      </td>
                      <td className="py-1.5 text-right">
                        {!s.is_system && (
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => startEdit(s)}
                              className="p-1 text-muted-foreground hover:text-foreground"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(s)}
                              className="p-1 text-muted-foreground hover:text-red-400"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showAdd ? (
        <form onSubmit={handleAdd} className="mt-3 flex items-end gap-2">
          <Input
            placeholder="Subcategory name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
          />
          <SimpleSelect
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={categoryOptions}
            placeholder="Select category"
            className="h-8 w-48 text-sm"
          />
          <Input
            placeholder="Monthly goal"
            type="number"
            step="0.01"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="h-8 w-36 text-sm"
          />
          <ColorPicker
            value={color}
            onChange={setColor}
            label="New subcategory color"
          />
          <Button type="submit" size="sm" className="h-8" loading={saving}>
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => setShowAdd(false)}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() => setShowAdd(true)}
        >
          <Plus size={14} className="mr-1" /> Add Subcategory
          <ShortcutHint commandId="setup.subcategories.add" />
        </Button>
      )}

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Subcategory"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        isLoading={deleting}
      />
      <ConfirmDeleteModal
        isOpen={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        onConfirm={handleBulkDelete}
        title="Delete Subcategories"
        message={`Delete ${selectedCount} selected subcategor${selectedCount === 1 ? "y" : "ies"}? This cannot be undone.`}
        isLoading={deleting}
      />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────

export function SetupPage() {
  const { accounts } = useAccounts();
  const { categories, subcategories } = useCategories();
  const [accountsOpen, setAccountsOpen] = useState(true);
  const [categoriesOpen, setCategoriesOpen] = useState(true);
  const [subcategoriesOpen, setSubcategoriesOpen] = useState(true);
  const successToast = useSuccessToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("provider") !== "akoya") return;

    const status = params.get("status");
    if (status === "connected") {
      successToast("Akoya account connected");
    } else if (status === "error") {
      toast.error(params.get("message") || "Akoya connection failed");
    }

    window.history.replaceState(null, "", "/setup");
  }, [successToast]);
  useShortcutScope("setup");
  useShortcut(
    "setup.toggleAccounts",
    useCallback(() => setAccountsOpen((open) => !open), []),
  );
  useShortcut(
    "setup.toggleCategories",
    useCallback(() => setCategoriesOpen((open) => !open), []),
  );
  useShortcut(
    "setup.toggleSubcategories",
    useCallback(() => setSubcategoriesOpen((open) => !open), []),
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Setup</h1>

      <CollapsibleSection
        title="Accounts"
        count={accounts?.length ?? 0}
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
      >
        <AccountsSection />
      </CollapsibleSection>

      <CollapsibleSection
        title="Categories"
        count={categories?.length ?? 0}
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
      >
        <CategoriesSection />
      </CollapsibleSection>

      <CollapsibleSection
        title="Subcategories"
        count={subcategories?.length ?? 0}
        open={subcategoriesOpen}
        onOpenChange={setSubcategoriesOpen}
      >
        <SubcategoriesSection />
      </CollapsibleSection>
    </div>
  );
}
