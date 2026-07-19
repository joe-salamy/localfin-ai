import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { describe, expect, test } from "vitest";
import { renderWithProviders } from "@/test/renderWithProviders";
import { Checkbox } from "./Checkbox";

function ControlledCheckbox({ disabled = false }: { disabled?: boolean }) {
  const [checked, setChecked] = useState(false);

  return (
    <label>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={(event) => setChecked(event.target.checked)}
      />
      Example preference
    </label>
  );
}

describe("Checkbox", () => {
  test("toggles through its label and the native Space key", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ControlledCheckbox />);
    const checkbox = screen.getByRole("checkbox", {
      name: "Example preference",
    });

    expect(checkbox).not.toBeChecked();
    await user.click(screen.getByText("Example preference"));
    expect(checkbox).toBeChecked();

    checkbox.focus();
    await user.keyboard(" ");
    expect(checkbox).not.toBeChecked();
  });

  test("preserves native checked and disabled semantics", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ControlledCheckbox disabled />);
    const checkbox = screen.getByRole("checkbox", {
      name: "Example preference",
    });

    expect(checkbox).toBeDisabled();
    await user.click(screen.getByText("Example preference"));
    expect(checkbox).not.toBeChecked();
  });

  test("forwards its ref to the native input", () => {
    const ref = createRef<HTMLInputElement>();
    renderWithProviders(<Checkbox ref={ref} aria-label="Forwarded checkbox" />);

    expect(ref.current).toBe(
      screen.getByRole("checkbox", { name: "Forwarded checkbox" }),
    );
  });

  test("sets and clears native and accessible mixed state", () => {
    const { rerender } = renderWithProviders(
      <Checkbox aria-label="Mixed checkbox" indeterminate />,
    );
    let checkbox = screen.getByRole("checkbox", { name: "Mixed checkbox" });

    expect(checkbox).toHaveProperty("indeterminate", true);
    expect(checkbox).toHaveAttribute("aria-checked", "mixed");

    rerender(<Checkbox aria-label="Mixed checkbox" indeterminate={false} />);
    checkbox = screen.getByRole("checkbox", { name: "Mixed checkbox" });
    expect(checkbox).toHaveProperty("indeterminate", false);
    expect(checkbox).not.toHaveAttribute("aria-checked");
  });
});
