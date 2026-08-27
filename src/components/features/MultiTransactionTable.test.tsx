import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AccountWithBalance, Category, Subcategory, Tag } from "@shared/contracts";
import { renderWithProviders } from "@/test/renderWithProviders";
import { MultiTransactionTable } from "./MultiTransactionTable";

const mocks = vi.hoisted(() => ({
  bulkCreate: vi.fn(),
  checkDuplicates: vi.fn(),
  checkTransferMatch: vi.fn(),
  parseStatement: vi.fn(),
}));

const account: AccountWithBalance = {
  id: "account-checking",
  name: "Checking",
  type: "asset",
  initial_balance: 0,
  color: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  deleted_at: null,
  current_balance: 0,
};
const category: Category = {
  id: "category-food",
  name: "Food",
  type: "expense",
  color: null,
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
  color: null,
  is_system: false,
  created_at: "2026-01-01",
  updated_at: null,
  deleted_at: null,
};
const tag: Tag = {
  id: "tag-trip",
  name: "Road Trip",
  type: "trip",
  color: null,
  created_at: "2026-01-01",
  updated_at: null,
  deleted_at: null,
};

vi.mock("@/hooks/useAccounts", () => ({
  useAccounts: () => ({ accounts: [account] }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [category], subcategories: [subcategory] }),
}));
vi.mock("@/hooks/useTags", () => ({
  useTags: () => ({
    tags: [tag],
    createTag: { mutateAsync: vi.fn() },
    deleteTag: { mutateAsync: vi.fn() },
    restoreTag: { mutateAsync: vi.fn() },
  }),
}));
vi.mock("@/hooks/useTransactions", () => ({
  useTransactions: () => ({
    bulkCreateTransactions: { mutateAsync: mocks.bulkCreate },
    checkDuplicates: { mutateAsync: mocks.checkDuplicates },
    checkTransferMatch: { mutateAsync: mocks.checkTransferMatch },
  }),
}));
vi.mock("@/hooks/useParser", () => ({
  useParser: () => ({
    parseStatement: { mutateAsync: mocks.parseStatement, isPending: false },
  }),
}));

function renderDraft() {
  return renderWithProviders(<MultiTransactionTable />);
}

beforeEach(() => {
  mocks.bulkCreate.mockReset().mockResolvedValue({ success: true, data: [] });
  mocks.checkDuplicates.mockReset().mockResolvedValue({
    success: true,
    data: [false],
  });
  mocks.checkTransferMatch.mockReset().mockResolvedValue({
    success: true,
    data: null,
  });
  mocks.parseStatement.mockReset().mockResolvedValue({
    success: true,
    data: {
      transactions: [],
      summary: {
        total: 0,
        duplicates: 0,
        fromLookup: 0,
        fromAI: 0,
        uncategorized: 0,
        needsReview: 0,
      },
      format: null,
      parseSuccessRate: 1,
      errors: [],
    },
  });
});

describe("MultiTransactionTable", () => {
  test("starts with five rows and supports add, remove, clear, undo, and redo", async () => {
    const user = userEvent.setup();
    renderDraft();

    expect(screen.getAllByPlaceholderText("Description")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: /Add Row/ }));
    expect(screen.getAllByPlaceholderText("Description")).toHaveLength(6);
    await user.click(screen.getAllByRole("button", { name: "Remove row" })[5]!);
    expect(screen.getAllByPlaceholderText("Description")).toHaveLength(5);

    await user.type(screen.getAllByPlaceholderText("Description")[0]!, "Draft");
    await user.click(screen.getByRole("button", { name: /Clear All/ }));
    expect(screen.queryByDisplayValue("Draft")).not.toBeInTheDocument();
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(screen.getByDisplayValue("Draft")).toBeVisible());
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Draft")).not.toBeInTheDocument(),
    );
  });

  test("grows pasted rows and normalizes date amount account category and tags", async () => {
    renderDraft();
    const dateInput = screen.getAllByPlaceholderText("MM/DD/YYYY")[0]!;
    fireEvent.paste(dateInput, {
      clipboardData: {
        getData: () =>
          "07/01/2026\tMarket\t12.34\texpense\tChecking\tGroceries\tRoad Trip\tfood\n07/02/2026\tCafe\t5.00\texpense\tChecking\tGroceries\tRoad Trip\tcoffee\n07/03/2026\tFuel\t40.00\texpense\tChecking\tGroceries\tRoad Trip\tgas\n07/04/2026\tHotel\t90.00\texpense\tChecking\tGroceries\tRoad Trip\tstay\n07/05/2026\tTolls\t8.00\texpense\tChecking\tGroceries\tRoad Trip\troad\n07/06/2026\tParking\t10.00\texpense\tChecking\tGroceries\tRoad Trip\tcar",
      },
    });

    await waitFor(() =>
      expect(screen.getAllByPlaceholderText("Description")).toHaveLength(6),
    );
    expect(screen.getByDisplayValue("Market")).toBeVisible();
    expect(screen.getByDisplayValue("07/01/2026")).toBeVisible();
    expect(screen.getByDisplayValue("-12.34")).toBeVisible();
    expect(screen.getAllByDisplayValue("Checking")[0]).toBeVisible();
    expect(screen.getAllByDisplayValue("Groceries")[0]).toBeVisible();
    expect(screen.getByDisplayValue("food")).toBeVisible();
  });

  test("imports statements and preserves native input editing", async () => {
    const user = userEvent.setup();
    mocks.parseStatement.mockResolvedValue({
      success: true,
      data: {
        transactions: [
          {
            date: "2026-07-02",
            name: "Imported Cafe",
            amount: -5,
            needsReview: false,
            confidence: 1,
            originalLine: "Imported Cafe 5",
            kind: "expense",
            subcategory_id: subcategory.id,
            subcategory_name: subcategory.name,
            category_name: category.name,
            categorizationSource: "none",
            isDuplicate: false,
          },
        ],
        summary: {
          total: 1,
          duplicates: 0,
          fromLookup: 0,
          fromAI: 0,
          uncategorized: 1,
          needsReview: 0,
        },
        format: "text",
        parseSuccessRate: 1,
        errors: [],
      },
    });
    renderDraft();

    const nameInput = screen.getAllByPlaceholderText(
      "Description",
    )[0] as HTMLInputElement;
    await user.type(nameInput, "Market");
    await user.type(screen.getAllByPlaceholderText("0.00")[0]!, "12.34");
    await user.selectOptions(screen.getAllByRole("combobox")[2]!, account.id);
    nameInput.setSelectionRange(3, 3);
    fireEvent.keyDown(nameInput, { key: "ArrowLeft" });
    expect(nameInput.selectionStart).toBe(3);

    await user.selectOptions(screen.getAllByRole("combobox")[0]!, account.id);
    await user.type(screen.getByPlaceholderText("Paste statement lines here"), "Imported Cafe 5");
    await user.click(screen.getByRole("button", { name: /Parse Statement/ }));
    await waitFor(() => expect(screen.getByDisplayValue("Imported Cafe")).toBeVisible());
  });

  test("saves only valid rows and resets only after successful persistence", async () => {
    const user = userEvent.setup();
    mocks.bulkCreate.mockRejectedValueOnce(new Error("save failed"));
    renderDraft();

    await user.type(screen.getAllByPlaceholderText("MM/DD/YYYY")[0]!, "07/01/2026");
    await user.type(screen.getAllByPlaceholderText("Description")[0]!, "Market");
    await user.type(screen.getAllByPlaceholderText("0.00")[0]!, "12.34");
    await user.selectOptions(screen.getAllByRole("combobox")[2]!, account.id);
    await user.selectOptions(screen.getAllByRole("combobox")[3]!, subcategory.id);

    await user.click(screen.getByRole("button", { name: /Save All/ }));
    await waitFor(() => expect(mocks.bulkCreate).toHaveBeenCalledTimes(1));
    expect(screen.getByDisplayValue("Market")).toBeVisible();

    mocks.bulkCreate.mockResolvedValueOnce({ success: true, data: [] });
    await user.click(screen.getByRole("button", { name: /Save All/ }));
    await waitFor(() => expect(mocks.bulkCreate).toHaveBeenCalledTimes(2));
    expect(mocks.bulkCreate.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({
        account_id: account.id,
        date: "2026-07-01",
        name: "Market",
        amount: -12.34,
        kind: "expense",
        subcategory_id: subcategory.id,
      }),
    ]);
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Market")).not.toBeInTheDocument(),
    );
  });
});

test("does not hijack Ctrl+A from native draft inputs", () => {
  renderDraft();
  const input = screen.getAllByPlaceholderText("Description")[0]!;
  input.focus();

  const event = new KeyboardEvent("keydown", {
    key: "a",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(false);
});
