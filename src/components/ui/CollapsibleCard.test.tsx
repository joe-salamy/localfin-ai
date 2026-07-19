import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import { renderWithProviders } from "@/test/renderWithProviders";
import { CollapsibleCard } from "./CollapsibleCard";

function TestCard() {
  const [open, setOpen] = useState(true);

  return (
    <CollapsibleCard title="Example Section" open={open} onOpenChange={setOpen}>
      <p>Section content</p>
    </CollapsibleCard>
  );
}

test("toggles section content from its disclosure button", async () => {
  const user = userEvent.setup();
  renderWithProviders(<TestCard />);

  const button = screen.getByRole("button", { name: "Example Section" });
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Section content")).toBeVisible();

  await user.click(button);
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("Section content")).not.toBeInTheDocument();

  await user.click(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Section content")).toBeVisible();
});
