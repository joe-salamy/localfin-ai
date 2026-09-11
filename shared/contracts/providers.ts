import { z } from "zod";
import type { AccountType } from "./accounts.js";
export type AccountLinkProvider = "plaid" | "akoya";

export type TargetInstitution = "us_bank" | "discover" | "fidelity";

export type ProviderConnectionStatus =
  | "active"
  | "needs_reauth"
  | "error"
  | "revoked";

export interface ProviderAccountSummary {
  id: string;
  local_account_id: string;
  provider_account_id: string;
  name: string;
  mask: string | null;
  type: AccountType;
  provider_type: string | null;
  provider_subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string | null;
  last_balance_at: string | null;
}

export interface ProviderConnectionSummary {
  id: string;
  provider: AccountLinkProvider;
  target_institution: TargetInstitution;
  institution_id: string | null;
  institution_name: string;
  status: ProviderConnectionStatus;
  last_sync_at: string | null;
  last_error: string | null;
  accounts: ProviderAccountSummary[];
  created_at: string;
  updated_at: string;
}

export interface PlaidLinkTokenResult {
  link_token: string;
  expiration: string | null;
}

export interface AkoyaAuthorizationResult {
  authorizationUrl: string;
  state: string;
}

export interface ProviderSyncResult {
  connectionId: string;
  provider: AccountLinkProvider;
  accountsUpserted: number;
  transactionsAdded: number;
  transactionsUpdated: number;
  transactionsRemoved: number;
  balanceAdjustmentsCreated: number;
  warnings: string[];
  syncedAt: string;
}

export const accountLinkProviderSchema = z.enum(["plaid", "akoya"]);
export const targetInstitutionSchema = z.enum([
  "us_bank",
  "discover",
  "fidelity",
]);
export const providerConnectionStatusSchema = z.enum([
  "active",
  "needs_reauth",
  "error",
  "revoked",
]);

