import { useCallback, useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Plus, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SimpleSelect } from "@/components/ui/SimpleSelect";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { EntityLabel } from "@/components/ui/EntityLabel";
import { ConfirmDeleteModal } from "@/components/features/ConfirmDeleteModal";
import { useAccounts } from "@/hooks/useAccounts";
import { useAccountLinking } from "@/hooks/useAccountLinking";
import { useTransactions } from "@/hooks/useTransactions";
import { ShortcutHint } from "@/features/shortcuts/ShortcutHint";
import { useShortcut, useShortcutScope } from "@/features/shortcuts/hooks";
import { useUndoRedo } from "@/features/undo-redo/hooks";
import { handleEnterSave } from "@/lib/enterSave";
import { shouldHandleFieldEditDoubleClick } from "@/lib/fieldEditDoubleClick";
import { useSuccessToast } from "@/features/display-settings/hooks";
import { PlaidConnectButton } from "@/features/account-linking/PlaidConnectButton";
import { SortHeader } from "@/components/features/setup/SetupSection";
import { applySortDirection, compareText, nextSort } from "@/components/features/setup/setupSort";
import type { AccountWithBalance, ProviderConnectionSummary } from "@shared/contracts";
import { useResizableColumns } from "@/features/table-layout/useResizableColumns";
import type { SortConfig } from "@/components/features/setup/setupSort";
import { formatCurrency, formatProviderName, formatConnectionStatus, formatDateTime, summarizeProviderSync, SETUP_ACCOUNT_COLUMN_DEFS } from "@/components/features/setup/setupShared";
import { TypeBadge } from "@/components/features/setup/TypeBadge";
import { ReconcileAccountModal } from "./ReconcileAccountModal";

export function AccountsSection() {
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
                    <td
                      className="py-1.5"
                      onDoubleClick={(event) => {
                        if (!shouldHandleFieldEditDoubleClick(event)) return;
                        startEdit(a);
                      }}
                    >
                      <EntityLabel id={a.id} name={a.name} color={a.color} />
                    </td>
                    <td
                      className="py-1.5"
                      onDoubleClick={(event) => {
                        if (!shouldHandleFieldEditDoubleClick(event)) return;
                        startEdit(a);
                      }}
                    >
                      <TypeBadge type={a.type} />
                    </td>
                    <td
                      className="py-1.5"
                      onDoubleClick={(event) => {
                        if (!shouldHandleFieldEditDoubleClick(event)) return;
                        startEdit(a);
                      }}
                    >
                      <ColorPicker
                        value={a.color}
                        onChange={(nextColor) => {
                          void updateAccountColor(a, nextColor);
                        }}
                        label={`${a.name} color`}
                      />
                    </td>
                    <td
                      className="py-1.5 text-right font-mono"
                      onDoubleClick={(event) => {
                        if (!shouldHandleFieldEditDoubleClick(event)) return;
                        startEdit(a);
                      }}
                    >
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
