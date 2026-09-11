import crypto from "node:crypto";
import { getDb } from "../../db/index.js";
import { UpstreamServiceError } from "../../errors.js";
import { mapPlaidAccountTypeToLocal } from "../provider-mappers.js";
import type {
  PlaidLinkTokenResult,
  ProviderConnectionSummary,
  TargetInstitution,
} from "../../../shared/contracts/index.js";
import type { AccountLinkingDependencies } from "./service.js";
import type { PlaidProviderClient } from "../providers/types.js";
import {
  assertTargetSupported,
  connectionSummaryFromRow,
  decryptAccessToken,
  encryptedColumns,
  errorChain,
  getConnectionById,
  getProviderAccounts,
  markConnectionError,
  MAX_SYNC_PAGES,
  nowIso,
  providerErrorMessage,
  readArray,
  readNumber,
  readRecord,
  readString,
  upsertProviderAccount,
  type NetworkPayload,
  type ProviderAccountDraft,
  type ProviderConnectionRow,
} from "./connections.js";

const PLAID_TARGETS = new Set<TargetInstitution>(["us_bank", "discover"]);

function inferInstitutionFromPlaidMetadata(metadata: unknown) {
  const metadataRecord = readRecord(metadata);
  const institution = metadataRecord ? metadataRecord.institution : null;
  return {
    institutionId: readString(institution, "institution_id"),
    institutionName: readString(institution, "name") ?? "Plaid institution",
  };
}

function normalizePlaidAccounts(response: unknown): ProviderAccountDraft[] {
  const accounts = Array.isArray(response)
    ? response
    : readArray(response, "accounts");
  return accounts
    .map((account) => {
      const balances = readRecord(account)?.balances;
      const providerType = readString(account, "type");
      const providerAccountId = readString(account, "account_id");
      const name = readString(account, "name");
      if (!providerAccountId || !name) return null;
      return {
        providerAccountId,
        name,
        officialName: readString(account, "official_name"),
        mask: readString(account, "mask"),
        type: mapPlaidAccountTypeToLocal(providerType),
        providerType,
        providerSubtype: readString(account, "subtype"),
        currentBalance: readNumber(balances, "current"),
        availableBalance: readNumber(balances, "available"),
        isoCurrencyCode: readString(balances, "iso_currency_code"),
        raw: account,
      };
    })
    .filter((account): account is ProviderAccountDraft => account !== null);
}

export async function fetchPlaidPayload(
  connection: ProviderConnectionRow,
  client: PlaidProviderClient,
): Promise<NetworkPayload> {
  const accessToken = decryptAccessToken(connection);
  const balances = await client.getBalances(accessToken);
  const accounts = normalizePlaidAccounts(balances);
  const startingCursor = connection.transactions_cursor;
  const collectPages = async () => {
    let cursor = startingCursor;
    const added: unknown[] = [];
    const modified: unknown[] = [];
    const removedIds: string[] = [];
    let pages = 0;
    for (;;) {
      if (pages >= MAX_SYNC_PAGES) {
        throw new Error(
          `Plaid sync exceeded ${MAX_SYNC_PAGES} pages; aborting to bound memory and request work`,
        );
      }
      pages += 1;
      const page = await client.syncTransactions({
        accessToken,
        cursor,
        count: 500,
      });
      added.push(...readArray(page, "added"));
      modified.push(...readArray(page, "modified"));
      for (const removed of readArray(page, "removed")) {
        const removedId = readString(removed, "transaction_id");
        if (removedId) removedIds.push(removedId);
      }
      cursor = readString(page, "next_cursor");
      const pageRecord = readRecord(page);
      const hasMore = pageRecord?.has_more === true;
      if (!hasMore) return { added, modified, removedIds, nextCursor: cursor };
    }
  };

  try {
    const transactions = await collectPages();
    return { accounts, ...transactions };
  } catch (error) {
    const causes = errorChain(error);
    const message = providerErrorMessage(error, "Unknown Plaid error");
    const errorCode = causes
      .map(
        (cause) =>
          readString(cause, "error_code") ?? readString(cause, "code"),
      )
      .find((code) => code !== null);
    if (
      errorCode !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
      !message.includes("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")
    ) {
      throw error;
    }
    try {
      const transactions = await collectPages();
      return { accounts, ...transactions };
    } catch (retryError) {
      const retryMessage = providerErrorMessage(retryError, message);
      markConnectionError(connection.id, retryMessage, "error");
      throw retryError;
    }
  }
}

export async function createPlaidLinkToken(
  targetInstitution: "us_bank" | "discover",
  dependencies: AccountLinkingDependencies,
): Promise<PlaidLinkTokenResult> {
  assertTargetSupported([...PLAID_TARGETS], targetInstitution, "Plaid linking is only supported for US Bank and Discover");
  const result = await dependencies.plaid.createPlaidLinkToken();
  const linkToken = readString(result, "link_token");
  if (!linkToken)
    throw new UpstreamServiceError("Plaid request failed", { cause: new Error("Plaid link token response did not include a link_token") })
  return {
    link_token: linkToken,
    expiration: readString(result, "expiration"),
  };
}

export async function exchangePlaidPublicToken(
  input: {
    publicToken: string;
    targetInstitution: "us_bank" | "discover";
    metadata: unknown;
  },
  dependencies: AccountLinkingDependencies,
): Promise<ProviderConnectionSummary> {
  assertTargetSupported([...PLAID_TARGETS], input.targetInstitution, "Plaid linking is only supported for US Bank and Discover");
  const exchange = await dependencies.plaid.exchangePublicToken(
    input.publicToken,
  );
  const exchangeRecord = readRecord(exchange);
  const accessToken =
    readString(exchangeRecord, "access_token") ??
    readString(exchangeRecord, "accessToken");
  const itemId =
    readString(exchangeRecord, "item_id") ??
    readString(exchangeRecord, "itemId");
  if (!accessToken || !itemId) {
    throw new UpstreamServiceError("Plaid request failed", { cause: new Error("Plaid public token exchange did not return an access token and item id") })
  }
  const balances = await dependencies.plaid.getBalances(accessToken);
  const accounts = normalizePlaidAccounts(balances);
  const institution = inferInstitutionFromPlaidMetadata(input.metadata);
  const [ciphertext, iv, tag] = encryptedColumns(accessToken);
  const db = getDb();
  const timestamp = nowIso();
  const connectionId = crypto.randomUUID();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO provider_connections (
         id, provider, target_institution, institution_id, institution_name,
         external_item_id, encrypted_access_token, access_token_iv, access_token_tag,
         status, created_at, updated_at
       ) VALUES (?, 'plaid', ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      connectionId,
      input.targetInstitution,
      institution.institutionId,
      institution.institutionName,
      itemId,
      ciphertext,
      iv,
      tag,
      timestamp,
      timestamp,
    );
    const connection = db
      .prepare("SELECT * FROM provider_connections WHERE id = ?")
      .get(connectionId) as ProviderConnectionRow;
    for (const account of accounts) {
      upsertProviderAccount(db, connection, account);
    }
  })();

  const created = getConnectionById(connectionId);
  if (!created) throw new Error("Provider connection was not created");
  return connectionSummaryFromRow(
    created,
    getProviderAccounts(db, connectionId),
  );
}
