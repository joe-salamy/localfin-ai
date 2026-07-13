import type { TargetInstitution } from "@shared/contracts";

export type PlaidTargetInstitution = Extract<
  TargetInstitution,
  "us_bank" | "discover"
>;

const PLAID_OAUTH_STORAGE_KEY = "localfin:plaid-oauth-link";

export function readStoredPlaidOAuthLinkToken(
  targetInstitution: PlaidTargetInstitution,
): string | null {
  if (
    typeof window === "undefined" ||
    !window.location.href.includes("oauth_state_id")
  ) {
    return null;
  }
  try {
    const stored = window.sessionStorage.getItem(PLAID_OAUTH_STORAGE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("targetInstitution" in parsed) ||
      parsed.targetInstitution !== targetInstitution ||
      !("linkToken" in parsed) ||
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

export function storePlaidOAuthLinkToken(
  targetInstitution: PlaidTargetInstitution,
  linkToken: string,
): void {
  try {
    window.sessionStorage.setItem(
      PLAID_OAUTH_STORAGE_KEY,
      JSON.stringify({ targetInstitution, linkToken }),
    );
  } catch {
    // Plaid Link still works for non-OAuth flows when storage is unavailable.
  }
}

export function clearStoredPlaidOAuthLinkToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PLAID_OAUTH_STORAGE_KEY);
  } catch {
    // Cleanup is best effort when storage is unavailable.
  }
}
