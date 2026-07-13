import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type {
  Category,
  Subcategory,
  SuspectTransactionFinding,
  Tag,
  TransactionWithDetails,
} from "@shared/contracts";
import { renderWithProviders } from "@/test/renderWithProviders";
import { TransactionTable } from "./TransactionTable";

const category: Category = {
  id: "category-food",
  name: "Food",
  type: "expense",
  color: "#f00",
  is_system: false,
  created_at: "2026-01-01",
  updated_at: null,
  deleted_at: null,
};

const subcategory: Subcategory = {
  id: "subcategory-groceries",
  category_id: category.id,
  name: "Groceries",
  monthly_goal: 500,
  color: "#0f0",
  is_system: false,
  created_at: "2026-01-01",
  updated_at: null,
  deleted_at: null,
};

const tag: Tag = {
  id: "tag-trip",
  name: "Road Trip",
  type: "trip",
  color: "#00f",
  created_at: "2026-01-01",
  updated_at: null,
  deleted_at: null,
};

const transaction: TransactionWithDetails = {
  id: "transaction-one",
  account_id: "account-checking",
  account_name: "Checking",
  account_type: "asset",
  date: "2026-07-01",
  name: "Corner Market",
  amount: -23.45,
  kind: "expense",
  subcategory_id: subcategory.id,
  subcategory_name: subcategory.name,
  category_id: category.id,
  category_name: category.name,
  comment: "weekly food",
  is_initial_balance: false,
  ai_suggested: false,
  created_at: "2026-07-01",
  updated_at: "2026-07-01",
  deleted_at: null,
  tags: [tag],
};

const suspectFinding: SuspectTransactionFinding = {
  id: "finding-one",
  scan_run_id: "scan-one",
  transaction_id: transaction.id,
  status: "open",
  severity: "high",
  score: 0.9,
  reason_codes: ["large_amount_outlier"],
  evidence: { summary: "Unusually large purchase" },
  created_at: "2026-07-01",
  updated_at: "2026-07-01",
};

function renderTable(overrides: Partial<React.ComponentProps<typeof TransactionTable>> = {}) {
  const props: React.ComponentProps<typeof TransactionTable> = {
    transactions: [transaction],
    selectedIds: new Set(),
    onSelectionChange: vi.fn(),
    sortColumn: "date",
    sortDirection: "desc",
    onSort: vi.fn(),
    onEdit: vi.fn(async () => true),
    onEditMany: vi.fn(async () => true),
    onDelete: vi.fn(async () => undefined),
    categories: [category],
    subcategories: [subcategory],
    tags: [tag],
    suspectFindings: [suspectFinding],
    onCreateTag: vi.fn(async () => tag),
    ...overrides,
  };
  return { ...renderWithProviders(<TransactionTable {...props} />), props };
}

describe("TransactionTable", () => {
  test("renders finance metadata and emits sorting and controlled selection", async () => {
    const user = userEvent.setup();
    const { props } = renderTable();

    expect(screen.getByText("Corner Market")).toBeVisible();
    expect(screen.getByText("Checking")).toBeVisible();
    expect(screen.getByText("Groceries")).toBeVisible();
    expect(screen.getByText("Road Trip")).toBeVisible();
    expect(screen.getByTitle("Unusually large purchase")).toBeVisible();

    await user.click(screen.getByText("Amount"));
    expect(props.onSort).toHaveBeenCalledWith("amount");

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1]!);
    expect(props.onSelectionChange).toHaveBeenCalledWith(
      new Set([transaction.id]),
    );
    await user.click(checkboxes[0]!);
    expect(props.onSelectionChange).toHaveBeenLastCalledWith(
      new Set([transaction.id]),
    );
  });

  test("double click and Enter save edited values while Escape cancels", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn(async () => true);
    renderTable({ onEdit });

    await user.dblClick(screen.getByText("Corner Market"));
    const nameInput = screen.getByDisplayValue("Corner Market");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Market{Enter}");
    await waitFor(() =>
      expect(onEdit).toHaveBeenCalledWith(
        transaction.id,
        expect.objectContaining({ name: "Updated Market" }),
      ),
    );

    await user.dblClick(screen.getByText("Corner Market"));
    await user.clear(screen.getByDisplayValue("Corner Market"));
    await user.type(screen.getByDisplayValue(""), "Cancelled{Escape}");
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByDisplayValue("Cancelled")).not.toBeInTheDocument();
  });

  test("keeps edit mode open after a failed asynchronous save", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn(async () => false);
    renderTable({ onEdit });

    await user.click(screen.getByTitle("Edit"));
    await user.clear(screen.getByDisplayValue("Corner Market"));
    await user.type(screen.getByDisplayValue(""), "Retry Market");
    await user.click(screen.getByTitle("Save"));

    await waitFor(() => expect(onEdit).toHaveBeenCalled());
    expect(screen.getByDisplayValue("Retry Market")).toBeVisible();
  });

  test("confirms deletion before invoking the callback", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => undefined);
    renderTable({ onDelete });

    await user.click(screen.getByTitle("Delete"));
    expect(screen.getByText(/Delete "Corner Market"/)).toBeVisible();
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByText("Delete", { selector: "button" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(transaction.id));
    expect(dialog).not.toBeInTheDocument();
  });

  test("copies, pastes, clears, and moves selected spreadsheet cells", async () => {
    const onEditMany = vi.fn(async () => true);
    renderTable({ onEditMany });
    const tableContainer = screen.getByRole("table").parentElement!;
    const transactionRow = screen.getByText("Corner Market").closest("tr")!;
    const dateCell = within(transactionRow).getAllByRole("cell")[1]!;

    fireEvent.pointerDown(dateCell, { button: 0 });
    fireEvent.pointerUp(dateCell);
    fireEvent.copy(tableContainer, {
      clipboardData: { setData: vi.fn() },
    });
    fireEvent.paste(tableContainer, {
      clipboardData: { getData: () => "2026-07-04" },
    });
    await waitFor(() =>
      expect(onEditMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: transaction.id,
            updates: expect.objectContaining({ date: "2026-07-04" }),
          }),
        ]),
        expect.anything(),
      ),
    );

    fireEvent.keyDown(tableContainer, { key: "Delete" });
    fireEvent.keyDown(tableContainer, { key: "ArrowRight" });
  });
});
