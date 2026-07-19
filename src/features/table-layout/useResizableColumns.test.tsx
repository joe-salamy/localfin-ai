import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { readTableColumnWidths } from "./storage";
import { useResizableColumns } from "./useResizableColumns";

const columns = [
  { id: "name", defaultWidth: 100, maxWidth: 300 },
  { id: "amount", defaultWidth: 80 },
] as const;

function ResizableTableHarness() {
  const layout = useResizableColumns("test.content-fit", columns);

  return (
    <table style={{ tableLayout: "fixed", minWidth: layout.totalWidth }}>
      <colgroup>
        {layout.columns.map((column) => (
          <col
            data-testid={`col-${column.id}`}
            key={column.id}
            style={layout.getColStyle(column.id)}
          />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th style={layout.getHeaderStyle("name")}>
            Name
            <span
              data-testid="name-resize-handle"
              {...layout.getResizeHandleProps("name")}
            />
          </th>
          <th style={layout.getHeaderStyle("amount")}>Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colSpan={2}>This spanning status row must not size either column</td>
        </tr>
        <tr>
          <td>Longest account name</td>
          <td>$1.00</td>
        </tr>
      </tbody>
    </table>
  );
}

beforeEach(() => {
  localStorage.clear();
});

test("double-click fits a column to its non-spanning contents and persists the width", () => {
  vi.spyOn(HTMLTableElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLTableElement) {
      if (this.style.position !== "fixed") return DOMRect.fromRect();

      const text = this.textContent ?? "";
      const width = text.includes("spanning status row")
        ? 500
        : text.includes("Longest account name")
          ? 236
          : 80;
      return DOMRect.fromRect({ width });
    },
  );

  render(<ResizableTableHarness />);
  expect(screen.getByTestId("col-name")).toHaveStyle({ width: "100px" });

  fireEvent.doubleClick(screen.getByTestId("name-resize-handle"));

  expect(screen.getByTestId("col-name")).toHaveStyle({ width: "236px" });
  expect(readTableColumnWidths("test.content-fit").name).toBe(236);
});
