import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { renderWithProviders } from "@/test/renderWithProviders";
import { SetupPage } from "./SetupPage";

const mocks = vi.hoisted(() => ({
  shortcuts: new Map<string, () => void>(),
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock("@/hooks/useAccounts", () => ({
  useAccounts: () => ({ accounts: [{ id: "one" }, { id: "two" }] }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "category" }],
    subcategories: [{ id: "one" }, { id: "two" }, { id: "three" }],
  }),
}));
vi.mock("@/hooks/useTags", () => ({
  useTags: () => ({
    tags: [
      { id: "active", deleted_at: null },
      { id: "deleted", deleted_at: "2026-01-01" },
    ],
  }),
}));
vi.mock("@/features/shortcuts/hooks", () => ({
  useShortcutScope: vi.fn(),
  useShortcut: (command: string, callback: () => void) => {
    mocks.shortcuts.set(command, callback);
  },
}));
vi.mock("@/features/display-settings/hooks", () => ({
  useSuccessToast: () => mocks.successToast,
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.errorToast },
  Toaster: () => null,
}));
vi.mock("@/components/features/setup/AccountsSection", () => ({
  AccountsSection: () => <div>Accounts content</div>,
}));
vi.mock("@/components/features/setup/CategoriesSection", () => ({
  CategoriesSection: () => <div>Categories content</div>,
}));
vi.mock("@/components/features/setup/SubcategoriesSection", () => ({
  SubcategoriesSection: () => <div>Subcategories content</div>,
}));
vi.mock("@/components/features/TagManager", () => ({
  TagManager: () => <div>Tags content</div>,
}));

beforeEach(() => {
  mocks.shortcuts.clear();
  mocks.successToast.mockReset();
  mocks.errorToast.mockReset();
  window.history.replaceState(null, "", "/setup");
});

test("renders live section counts and supports disclosure buttons and shortcuts", async () => {
  const user = userEvent.setup();
  renderWithProviders(<SetupPage />);

  expect(screen.getByRole("heading", { name: "Setup" })).toBeVisible();
  expect(screen.getByRole("button", { name: /Accounts\s*\(2\)/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Categories\s*\(1\)/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Subcategories\s*\(3\)/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Tags\s*\(1\)/ })).toBeVisible();

  await user.click(screen.getByRole("button", { name: /Accounts\s*\(2\)/ }));
  expect(screen.queryByText("Accounts content")).not.toBeInTheDocument();

  act(() => mocks.shortcuts.get("setup.toggleCategories")?.());
  expect(screen.queryByText("Categories content")).not.toBeInTheDocument();
  act(() => mocks.shortcuts.get("setup.toggleCategories")?.());
  expect(screen.getByText("Categories content")).toBeVisible();
});

test("reports Akoya callback status and removes callback parameters", () => {
  window.history.replaceState(
    null,
    "",
    "/setup?provider=akoya&status=connected",
  );
  renderWithProviders(<SetupPage />);
  expect(mocks.successToast).toHaveBeenCalledWith("Akoya account connected");
  expect(window.location.pathname).toBe("/setup");
  expect(window.location.search).toBe("");
});

test("reports an Akoya callback error and removes callback parameters", () => {
  window.history.replaceState(
    null,
    "",
    "/setup?provider=akoya&status=error&message=Authorization%20failed",
  );
  renderWithProviders(<SetupPage />);
  expect(mocks.errorToast).toHaveBeenCalledWith("Authorization failed");
  expect(window.location.pathname).toBe("/setup");
  expect(window.location.search).toBe("");
});
