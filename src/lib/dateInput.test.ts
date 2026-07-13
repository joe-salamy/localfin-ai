import { expect, test } from "vitest"
import { parsePastedDate } from "./transactionCellParsing";
import { formatDateInput } from "./utils";

test("formatDateInput formats eight typed digits as MM/DD/YYYY", () => {
  expect(formatDateInput("01012026")).toBe("01/01/2026");
});

test("formatDateInput normalizes single-digit month and day only when YYYY is present", () => {
  expect(formatDateInput("1/2/2026")).toBe("01/02/2026");
});

test("formatDateInput keeps partial YYYY input usable while typing", () => {
  const typedDigits = [
    { value: "0", expected: "0" },
    { value: "01", expected: "01" },
    { value: "010", expected: "01/0" },
    { value: "0101", expected: "01/01" },
    { value: "01012", expected: "01/01/2" },
    { value: "010120", expected: "01/01/20" },
    { value: "0101202", expected: "01/01/202" },
  ];

  for (const { value, expected } of typedDigits) {
    expect(formatDateInput(value), value).toBe(expected);
  }
});

test("formatDateInput does not expand slash-delimited two-digit years", () => {
  expect(formatDateInput("1/2/26")).toBe("1/2/26");
});

test("parsePastedDate accepts display dates with four-digit years", () => {
  expect(parsePastedDate("1/2/2026")).toEqual({
    displayDate: "01/02/2026",
    isoDate: "2026-01-02",
  });
});

test("parsePastedDate accepts ISO dates", () => {
  expect(parsePastedDate("2026-01-02")).toEqual({
    displayDate: "01/02/2026",
    isoDate: "2026-01-02",
  });
});

test("parsePastedDate rejects display dates with two-digit years", () => {
  expect(parsePastedDate("1/2/26")).toBe(null);
});

test("parsePastedDate rejects invalid calendar dates", () => {
  expect(parsePastedDate("02/29/2025")).toBe(null);
  expect(parsePastedDate("2026-02-30")).toBe(null);
});
