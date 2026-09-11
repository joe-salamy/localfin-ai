import crypto from "node:crypto";
import { getDb } from "../../db/index.js";
import { ENV_KEYS, PROVIDER_CONFIG } from "../../config/app.js";
import { BadRequestError, UpstreamServiceError } from "../../errors.js";
import { mapAkoyaAccountTypeToLocal } from "../provider-mappers.js";
import * as akoyaClient from "../providers/akoya-client.js";
import type {
  AkoyaAuthorizationResult,
  ProviderConnectionSummary,
  TargetInstitution,
} from "../../../shared/contracts/index.js";
import type { AccountLinkingDependencies } from "./service.js";
import type { AkoyaProviderClient } from "../providers/types.js";
import {
  assertTargetSupported,
  connectionSummaryFromRow,
  decryptRefreshToken,
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
  requireEnv,
  type NetworkPayload,
  type ProviderAccountDraft,
  type ProviderConnectionRow,
} from "./connections.js";

const AKOYA_TARGETS = new Set<TargetInstitution>(["fidelity"]);

function normalizeAkoyaAccounts(response: unknown): ProviderAccountDraft[] {
  const candidateArrays = [
    readArray(response, "accounts"),
    readArray(response, "depositAccounts"),
    readArray(response, "investmentAccounts"),
    readArray(response, "loanAccounts"),
    readArray(response, "lineOfCreditAccounts"),
  ];
  const accounts = candidateArrays.flat();
  return accounts
    .map((account): ProviderAccountDraft | null => {
      const providerAccountId =
        readString(account, "accountId") ?? readString(account, "account_id");
      const name =
        readString(account, "nickname") ??
        readString(account, "displayName") ??
        readString(account, "name") ??
        readString(account, "accountType");
      if (!providerAccountId || !name) return null;
      const category =
        readString(account, "category") ??
        readString(account, "accountCategory") ??
        readString(account, "accountType");
      return {
        providerAccountId,
        name,
        officialName: readString(account, "description"),
        mask:
          readString(account, "accountNumberDisplay") ??
          readString(account, "accountNumberMasked") ??
          readString(account, "mask"),
        type: mapAkoyaAccountTypeToLocal(category),
        providerType: category,
        providerSubtype: readString(account, "accountType"),
        currentBalance:
          readNumber(account, "currentBalance") ??
          readNumber(account, "balance") ??
          readNumber(account, "marketValue"),
        availableBalance: readNumber(account, "availableBalance"),
        isoCurrencyCode: readString(account, "currency") ?? "USD",
        raw: account,
      };
    })
    .filter((account): account is ProviderAccountDraft => account !== null);
}

function transactionArrays(response: unknown) {
  if (Array.isArray(response)) return response;
  return [
    ...readArray(response, "transactions"),
    ...readArray(response, "depositTransactions"),
    ...readArray(response, "investmentTransactions"),
    ...readArray(response, "loanTransactions"),
    ...readArray(response, "lineOfCreditTransactions"),
  ];
}

export async function fetchAkoyaPayload(
  connection: ProviderConnectionRow,
  client: AkoyaProviderClient,
): Promise<NetworkPayload> {
  const refreshToken = decryptRefreshToken(connection);
  try {
    const refreshed = await client.refreshTokens({ refreshToken });
    const refreshedRecord = readRecord(refreshed);
    const idToken =
      readString(refreshedRecord, "id_token") ??
      readString(refreshedRecord, "access_token");
    const nextRefreshToken =
      readString(refreshedRecord, "refresh_token") ?? refreshToken;
    if (!idToken)
      throw new UpstreamServiceError("Akoya request failed", { cause: new Error("Akoya refresh response did not include an id_token") })

    const akoyaProviderId = connection.akoya_provider_id ?? undefined;
    const balances = await client.getBalances({
      idToken,
      providerId: akoyaProviderId,
    });
    const accounts = normalizeAkoyaAccounts(balances);
    const added: unknown[] = [];
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - 90);
    startDate.setUTCHours(0, 0, 0, 0);
    const startTime = startDate.toISOString();
    const endTime = new Date().toISOString();

    let pages = 0;
    for (const account of accounts) {
      let offset = 0;
      const limit = 500;
      for (;;) {
        if (pages >= MAX_SYNC_PAGES) {
          throw new Error(
            `Akoya sync exceeded ${MAX_SYNC_PAGES} pages; aborting to bound memory and request work`,
          );
        }
        pages += 1;
        const page = await client.getTransactions({
          idToken,
          accountId: account.providerAccountId,
          startTime,
          endTime,
          limit,
          offset,
          providerId: akoyaProviderId,
        });
        const transactions = transactionArrays(page);
        for (const transaction of transactions) {
          const record = readRecord(transaction);
          added.push(
            record
              ? {
                  ...record,
                  accountId:
                    readString(record, "accountId") ??
                    account.providerAccountId,
                }
              : transaction,
          );
        }
        if (transactions.length < limit) break;
        offset += limit;
      }
    }

    return {
      accounts,
      added,
      modified: [],
      removedIds: [],
      nextCursor: connection.transactions_cursor,
      refreshedAccessToken: idToken,
      refreshedRefreshToken: nextRefreshToken,
    };
  } catch (error) {
    const causes = errorChain(error);
    const message = providerErrorMessage(error, "Unknown Akoya error");
    const status = causes
      .map((cause) => readNumber(cause, "status"))
      .find((value) => value !== null);
    if (
      status === 401 ||
      status === 403 ||
      message.includes("401") ||
      message.includes("403")
    ) {
      markConnectionError(connection.id, message, "needs_reauth");
    }
    throw error;
  }
}

export function createAkoyaAuthorizationUrl(
  targetInstitution: "fidelity",
): AkoyaAuthorizationResult {
  assertTargetSupported([...AKOYA_TARGETS], targetInstitution, "Akoya linking is only supported for Fidelity");
  const clientId = requireEnv(ENV_KEYS.akoyaClientId);
  const redirectUri = requireEnv(ENV_KEYS.akoyaRedirectUri);
  const state = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO provider_oauth_states (
         state, provider, target_institution, redirect_after, expires_at
       ) VALUES (?, 'akoya', 'fidelity', ?, ?)`,
    )
    .run(state, redirectUri, expiresAt);
  const authBaseUrl = akoyaClient.assertProviderBaseUrl(
    process.env[ENV_KEYS.akoyaAuthBaseUrl] ?? PROVIDER_CONFIG.akoyaAuthBaseUrl,
    ENV_KEYS.akoyaAuthBaseUrl,
  );
  const connector =
    process.env[ENV_KEYS.akoyaConnector] ?? PROVIDER_CONFIG.akoyaConnector;
  const scope = encodeURIComponent(PROVIDER_CONFIG.akoyaScope);
  const authorizationUrl = `${authBaseUrl}/auth?connector=${encodeURIComponent(
    connector,
  )}&response_type=code&client_id=${encodeURIComponent(
    clientId,
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}`;
  return { authorizationUrl, state };
}

export async function handleAkoyaCallback(
  input: {
    code: string;
    state: string;
  },
  dependencies: AccountLinkingDependencies,
): Promise<ProviderConnectionSummary> {
  const db = getDb();
  // Atomically claim the state: only one concurrent callback can flip
  // consumed_at, so a replayed/raced callback cannot exchange the code twice.
  const now = new Date().toISOString();
  const claimed = db
    .prepare(
      `UPDATE provider_oauth_states
          SET consumed_at = ?
        WHERE state = ? AND provider = 'akoya' AND target_institution = 'fidelity'
          AND consumed_at IS NULL AND expires_at >= ?`,
    )
    .run(now, input.state, now);
  if (claimed.changes === 0) {
    const stateRow = db
      .prepare(
        `SELECT consumed_at, expires_at FROM provider_oauth_states WHERE state = ?`,
      )
      .get(input.state) as
      | { consumed_at: string | null; expires_at: string }
      | undefined;
    if (!stateRow || stateRow.consumed_at) {
      throw new BadRequestError("Invalid Akoya state");
    }
    throw new BadRequestError("Akoya state expired");
  }

  const redirectUri = requireEnv(ENV_KEYS.akoyaRedirectUri);
  const tokens = await dependencies.akoya.exchangeCodeForTokens({
    code: input.code,
    redirectUri,
  });
  const tokenRecord = readRecord(tokens);
  const idToken =
    readString(tokenRecord, "id_token") ??
    readString(tokenRecord, "access_token");
  const refreshToken = readString(tokenRecord, "refresh_token");
  if (!idToken || !refreshToken) {
    throw new UpstreamServiceError("Akoya request failed", { cause: new Error("Akoya token exchange did not return id_token and refresh_token") })
  }

  const [accessCiphertext, accessIv, accessTag] = encryptedColumns(idToken);
  const [refreshCiphertext, refreshIv, refreshTag] =
    encryptedColumns(refreshToken);
  const timestamp = nowIso();
  const connectionId = crypto.randomUUID();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO provider_connections (
         id, provider, target_institution, institution_name, akoya_provider_id,
         akoya_connector, encrypted_access_token, access_token_iv, access_token_tag,
         encrypted_refresh_token, refresh_token_iv, refresh_token_tag,
         status, created_at, updated_at
       ) VALUES (?, 'akoya', 'fidelity', 'Fidelity', ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      connectionId,
      process.env[ENV_KEYS.akoyaProviderId] ?? PROVIDER_CONFIG.akoyaProviderId,
      process.env[ENV_KEYS.akoyaConnector] ?? PROVIDER_CONFIG.akoyaConnector,
      accessCiphertext,
      accessIv,
      accessTag,
      refreshCiphertext,
      refreshIv,
      refreshTag,
      timestamp,
      timestamp,
    );
  })();

  const created = getConnectionById(connectionId);
  if (!created) throw new Error("Provider connection was not created");
  return connectionSummaryFromRow(
    created,
    getProviderAccounts(db, connectionId),
  );
}
