import { beforeEach, expect, test, vi } from "vitest";
import {
  clearStoredPlaidOAuthLinkToken,
  readStoredPlaidOAuthLinkToken,
  storePlaidOAuthLinkToken,
} from "./plaidOAuthStorage";

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/setup");
});

test("restores only the matching OAuth redirect token", () => {
  storePlaidOAuthLinkToken("us_bank", "link-token");
  expect(readStoredPlaidOAuthLinkToken("us_bank")).toBeNull();

  window.history.replaceState({}, "", "/setup?oauth_state_id=state");
  expect(readStoredPlaidOAuthLinkToken("discover")).toBeNull();
  expect(readStoredPlaidOAuthLinkToken("us_bank")).toBe("link-token");
});

test("cleanup removes the stored redirect token", () => {
  storePlaidOAuthLinkToken("discover", "link-token");
  clearStoredPlaidOAuthLinkToken();
  window.history.replaceState({}, "", "/setup?oauth_state_id=state");
  expect(readStoredPlaidOAuthLinkToken("discover")).toBeNull();
});

test("unavailable storage is tolerated", () => {
  const getItem = vi
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation(() => {
      throw new Error("disabled");
    });
  const setItem = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("disabled");
    });
  const removeItem = vi
    .spyOn(Storage.prototype, "removeItem")
    .mockImplementation(() => {
      throw new Error("disabled");
    });
  window.history.replaceState({}, "", "/setup?oauth_state_id=state");

  expect(() => storePlaidOAuthLinkToken("us_bank", "token")).not.toThrow();
  expect(readStoredPlaidOAuthLinkToken("us_bank")).toBeNull();
  expect(() => clearStoredPlaidOAuthLinkToken()).not.toThrow();

  getItem.mockRestore();
  setItem.mockRestore();
  removeItem.mockRestore();
});
