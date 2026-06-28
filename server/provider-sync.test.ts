import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { closeDbForTests, getDb } from "./db/index.js";
import * as service from "./services/account-linking.js";

const originalDbPath = process.env.LOCALFIN_DB_PATH;
const originalProviderSecret = process.env.LOCALFIN_PROVIDER_SECRET;

interface PlaidFixtureState {
  balances: unknown;
  syncPages: unknown[];
  exchange: unknown;
}

interface AkoyaFixtureState {
  exchange: unknown;
  refresh: unknown;
  balances: unknown;
  transactions: unknown[];
  lastProviderIds: Array<string | undefined>;
}

interface CountRow {
  count: number;
}

interface ConnectionTokenRow {
  encrypted_access_token: string;
  access_token_iv: string;
  access_token_tag: string;
}

interface CursorRow {
  transactions_cursor: string | null;
}

interface DeletedAtRow {
  deleted_at: string | null;
}

interface StatusRow {
  status: string;
}

const plaidState: PlaidFixtureState = {
  balances: { accounts: [] },
  syncPages: [{ added: [], modified: [], removed: [], next_cursor: null, has_more: false }],
  exchange: { access_token: "plaid-access-token", item_id: "plaid-item-1" },
};
const akoyaState: AkoyaFixtureState = {
  exchange: { id_token: "akoya-id-token", refresh_token: "akoya-refresh-token" },
  refresh: { id_token: "akoya-refreshed-id-token", refresh_token: "akoya-next-refresh-token" },
  balances: { accounts: [] },
  transactions: [],
  lastProviderIds: [],
};


async function useTempDatabase(t: TestContext) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-provider-test-"));
  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
  process.env.LOCALFIN_PROVIDER_SECRET = "provider-test-secret-at-least-32-characters";
  process.env.AKOYA_CLIENT_ID = "akoya-client-id";
  process.env.AKOYA_CLIENT_SECRET = "akoya-client-secret";
  process.env.AKOYA_REDIRECT_URI = "http://localhost:3001/api/account-linking/akoya/callback";
  t.after(async () => {
    closeDbForTests();
    if (originalDbPath === undefined) {
      delete process.env.LOCALFIN_DB_PATH;
    } else {
      process.env.LOCALFIN_DB_PATH = originalDbPath;
    }
    if (originalProviderSecret === undefined) {
      delete process.env.LOCALFIN_PROVIDER_SECRET;
    } else {
      process.env.LOCALFIN_PROVIDER_SECRET = originalProviderSecret;
    }
    await rm(tempDir, { recursive: true, force: true });
  });
}

function resetProviderState() {
  plaidState.exchange = { access_token: "plaid-access-token", item_id: "plaid-item-1" };
  plaidState.balances = {
    accounts: [
      {
        account_id: "plaid-checking-1",
        name: "Checking",
        mask: "1111",
        type: "depository",
        subtype: "checking",
        balances: { current: 100, available: 90, iso_currency_code: "USD" },
      },
    ],
  };
  plaidState.syncPages = [
    { added: [], modified: [], removed: [], next_cursor: "cursor-empty", has_more: false },
  ];
  akoyaState.exchange = { id_token: "akoya-id-token", refresh_token: "akoya-refresh-token" };
  akoyaState.refresh = { id_token: "akoya-refreshed-id-token", refresh_token: "akoya-next-refresh-token" };
  akoyaState.balances = { accounts: [] };
  akoyaState.transactions = [];
  akoyaState.lastProviderIds = [];
}

function installProviderClientMocks(t: TestContext) {
  const restore = service.setProviderClientsForTests({
    plaid: {
      createPlaidLinkToken: async () => ({ link_token: "link-token", expiration: null }),
      exchangePublicToken: async () => plaidState.exchange,
      getBalances: async () => plaidState.balances,
      syncTransactions: async () => plaidState.syncPages.shift(),
      removeItem: async () => undefined,
    },
    akoya: {
      exchangeCodeForTokens: async () => akoyaState.exchange,
      refreshTokens: async () => akoyaState.refresh,
      getBalances: async (input: { providerId?: string }) => {
        akoyaState.lastProviderIds.push(input.providerId);
        if (akoyaState.balances instanceof Error) throw akoyaState.balances;
        return akoyaState.balances;
      },
      getTransactions: async (input: { providerId?: string }) => {
        akoyaState.lastProviderIds.push(input.providerId);
        return akoyaState.transactions;
      },
      revokeToken: async () => undefined,
    },
  });
  t.after(restore);
}

test("Plaid linking creates encrypted connection, provider accounts, and local accounts", async (t) => {
  await useTempDatabase(t);
  resetProviderState();
  installProviderClientMocks(t);

  const connection = await service.exchangePlaidPublicToken({
    publicToken: "public-token",
    targetInstitution: "us_bank",
    metadata: { institution: { institution_id: "ins_1", name: "US Bank" } },
  });

  assert.equal(connection.provider, "plaid");
  assert.equal(connection.accounts.length, 1);
  const db = getDb();
  const tokenRow = db
    .prepare(
      `SELECT encrypted_access_token, access_token_iv, access_token_tag
       FROM provider_connections
       WHERE id = ?`,
    )
    .get(connection.id) as ConnectionTokenRow;
  assert.notEqual(tokenRow.encrypted_access_token, "plaid-access-token");
  assert.ok(tokenRow.access_token_iv.length > 0);
  assert.ok(tokenRow.access_token_tag.length > 0);
  const accountCount = db
    .prepare("SELECT COUNT(*) AS count FROM accounts WHERE deleted_at IS NULL")
    .get() as CountRow;
  const providerAccountCount = db
    .prepare("SELECT COUNT(*) AS count FROM provider_accounts WHERE deleted_at IS NULL")
    .get() as CountRow;
  assert.equal(accountCount.count, 1);
  assert.equal(providerAccountCount.count, 1);
});

test("first Plaid sync imports transactions, cursor, and provider balance adjustment", async (t) => {
  await useTempDatabase(t);
  resetProviderState();
  installProviderClientMocks(t);
  const connection = await service.exchangePlaidPublicToken({
    publicToken: "public-token",
    targetInstitution: "discover",
    metadata: { institution: { institution_id: "ins_2", name: "Discover" } },
  });
  plaidState.syncPages = [
    {
      added: [
        {
          account_id: "plaid-checking-1",
          transaction_id: "tx-1",
          date: "2026-06-01",
          name: "Groceries",
          amount: 12,
        },
        {
          account_id: "plaid-checking-1",
          transaction_id: "tx-2",
          date: "2026-06-02",
          name: "Payroll",
          amount: -22,
        },
      ],
      modified: [],
      removed: [],
      next_cursor: "cursor-1",
      has_more: false,
    },
  ];

  const [result] = await service.syncProviderConnections({ connectionId: connection.id });

  assert.equal(result.transactionsAdded, 2);
  assert.equal(result.balanceAdjustmentsCreated, 1);
  assert.equal(result.connectionId, connection.id);
  const db = getDb();
  const cursor = db
    .prepare("SELECT transactions_cursor FROM provider_connections WHERE id = ?")
    .get(connection.id) as CursorRow;
  const plaidTransactionCount = db
    .prepare("SELECT COUNT(*) AS count FROM transactions WHERE provider = 'plaid' AND deleted_at IS NULL")
    .get() as CountRow;
  assert.equal(cursor.transactions_cursor, "cursor-1");
  assert.equal(plaidTransactionCount.count, 3);
});

test("repeating the same Plaid sync does not duplicate transactions or adjustments", async (t) => {
  await useTempDatabase(t);
  resetProviderState();
  installProviderClientMocks(t);
  const connection = await service.exchangePlaidPublicToken({
    publicToken: "public-token",
    targetInstitution: "us_bank",
    metadata: { institution: { name: "US Bank" } },
  });
  const repeatedPage = {
    added: [
      {
        account_id: "plaid-checking-1",
        transaction_id: "tx-repeat-1",
        date: "2026-06-03",
        name: "Coffee",
        amount: 5,
      },
    ],
    modified: [],
    removed: [],
    next_cursor: "cursor-repeat",
    has_more: false,
  };
  plaidState.syncPages = [repeatedPage];
  await service.syncProviderConnections({ connectionId: connection.id });
  plaidState.syncPages = [repeatedPage];
  const [second] = await service.syncProviderConnections({ connectionId: connection.id });

  const db = getDb();
  assert.equal(second.transactionsAdded, 0);
  assert.equal(second.balanceAdjustmentsCreated, 0);
  const repeatedTransactionCount = db
    .prepare(
      "SELECT COUNT(*) AS count FROM transactions WHERE provider_transaction_id = 'tx-repeat-1' AND deleted_at IS NULL",
    )
    .get() as CountRow;
  const adjustmentCount = db
    .prepare("SELECT COUNT(*) AS count FROM transactions WHERE kind = 'adjustment' AND deleted_at IS NULL")
    .get() as CountRow;
  assert.equal(repeatedTransactionCount.count, 1);
  assert.equal(adjustmentCount.count, 1);
});

test("Plaid removed transaction soft-deletes the provider transaction without deleting local account", async (t) => {
  await useTempDatabase(t);
  resetProviderState();
  installProviderClientMocks(t);
  const connection = await service.exchangePlaidPublicToken({
    publicToken: "public-token",
    targetInstitution: "discover",
    metadata: { institution: { name: "Discover" } },
  });
  plaidState.syncPages = [
    {
      added: [
        {
          account_id: "plaid-checking-1",
          transaction_id: "tx-remove-1",
          date: "2026-06-04",
          name: "Temporary",
          amount: 9,
        },
      ],
      modified: [],
      removed: [],
      next_cursor: "cursor-before-remove",
      has_more: false,
    },
  ];
  await service.syncProviderConnections({ connectionId: connection.id });
  plaidState.syncPages = [
    {
      added: [],
      modified: [],
      removed: [{ transaction_id: "tx-remove-1" }],
      next_cursor: "cursor-after-remove",
      has_more: false,
    },
  ];

  const [removed] = await service.syncProviderConnections({ connectionId: connection.id });

  const db = getDb();
  assert.equal(removed.transactionsRemoved, 1);
  const removedRow = db
    .prepare("SELECT deleted_at FROM transactions WHERE provider_transaction_id = 'tx-remove-1'")
    .get() as DeletedAtRow;
  const accountCount = db
    .prepare("SELECT COUNT(*) AS count FROM accounts WHERE deleted_at IS NULL")
    .get() as CountRow;
  assert.equal(removedRow.deleted_at !== null, true);
  assert.equal(accountCount.count, 1);
});

test("Akoya 401 after refresh marks connection needs_reauth and preserves local rows", async (t) => {
  await useTempDatabase(t);
  resetProviderState();
  installProviderClientMocks(t);
  const authorization = service.createAkoyaAuthorizationUrl("fidelity");
  const connection = await service.handleAkoyaCallback({
    code: "oauth-code",
    state: authorization.state,
  });
  const db = getDb();
  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO accounts (id, name, type, initial_balance, color, created_at, updated_at)
     VALUES ('local-akoya-account', 'Fidelity Brokerage', 'asset', 0, NULL, ?, ?)`,
  ).run(timestamp, timestamp);
  db.prepare(
    `INSERT INTO provider_accounts (
       id, connection_id, local_account_id, provider_account_id, name, type, created_at, updated_at
     ) VALUES ('provider-akoya-account', ?, 'local-akoya-account', 'akoya-account-1', 'Brokerage', 'asset', ?, ?)`,
  ).run(connection.id, timestamp, timestamp);
  db.prepare(
    `INSERT INTO transactions (
       id, account_id, date, name, amount, kind, is_initial_balance, ai_suggested,
       provider, provider_connection_id, provider_account_id, provider_transaction_id,
       created_at, updated_at
     ) VALUES (
       'akoya-existing-transaction', 'local-akoya-account', '2026-06-01', 'Existing', 10,
       'income', 0, 0, 'akoya', ?, 'akoya-account-1', 'akoya-existing', ?, ?
     )`,
  ).run(connection.id, timestamp, timestamp);
  akoyaState.balances = Object.assign(new Error("Akoya returned 401"), { status: 401 });

  await assert.rejects(
    service.syncProviderConnections({ connectionId: connection.id }),
    /401/,
  );

  const statusRow = db
    .prepare("SELECT status FROM provider_connections WHERE id = ?")
    .get(connection.id) as StatusRow;
  const accountCount = db
    .prepare("SELECT COUNT(*) AS count FROM accounts WHERE id = 'local-akoya-account' AND deleted_at IS NULL")
    .get() as CountRow;
  const transactionCount = db
    .prepare(
      "SELECT COUNT(*) AS count FROM transactions WHERE id = 'akoya-existing-transaction' AND deleted_at IS NULL",
    )
    .get() as CountRow;
  assert.equal(statusRow.status, "needs_reauth");
  assert.equal(accountCount.count, 1);
  assert.equal(transactionCount.count, 1);
});

test("Akoya sync uses the provider id stored on the connection", async (t) => {
  await useTempDatabase(t);
  resetProviderState();
  installProviderClientMocks(t);
  process.env.AKOYA_PROVIDER_ID = "stored-provider-id";
  const authorization = service.createAkoyaAuthorizationUrl("fidelity");
  const connection = await service.handleAkoyaCallback({
    code: "oauth-code",
    state: authorization.state,
  });
  process.env.AKOYA_PROVIDER_ID = "changed-provider-id";
  akoyaState.balances = {
    accounts: [
      {
        accountId: "akoya-account-1",
        name: "Brokerage",
        category: "investment",
        currentBalance: 0,
      },
    ],
  };

  await service.syncProviderConnections({ connectionId: connection.id });

  assert.deepEqual(akoyaState.lastProviderIds, ["stored-provider-id", "stored-provider-id"]);
});

test("Plaid sync skips null provider balances instead of zeroing accounts", async (t) => {
  await useTempDatabase(t);
  resetProviderState();
  installProviderClientMocks(t);
  plaidState.balances = {
    accounts: [
      {
        account_id: "plaid-checking-1",
        name: "Checking",
        mask: "1111",
        type: "depository",
        subtype: "checking",
        balances: { current: null, available: null, iso_currency_code: "USD" },
      },
    ],
  };
  const connection = await service.exchangePlaidPublicToken({
    publicToken: "public-token",
    targetInstitution: "us_bank",
    metadata: { institution: { institution_id: "ins_1", name: "US Bank" } },
  });

  const results = await service.syncProviderConnections({ connectionId: connection.id });
  const adjustmentCount = getDb()
    .prepare(
      "SELECT COUNT(*) AS count FROM transactions WHERE name = 'Provider balance sync' AND deleted_at IS NULL",
    )
    .get() as CountRow;

  assert.equal(results[0]?.balanceAdjustmentsCreated, 0);
  assert.match(results[0]?.warnings[0] ?? "", /Missing provider balance/);
  assert.equal(adjustmentCount.count, 0);
});

test("syncing an inactive requested connection rejects instead of returning an empty success", async (t) => {
  await useTempDatabase(t);
  resetProviderState();
  installProviderClientMocks(t);
  const connection = await service.exchangePlaidPublicToken({
    publicToken: "public-token",
    targetInstitution: "us_bank",
    metadata: { institution: { institution_id: "ins_1", name: "US Bank" } },
  });
  getDb()
    .prepare("UPDATE provider_connections SET status = 'needs_reauth' WHERE id = ?")
    .run(connection.id);

  await assert.rejects(
    service.syncProviderConnections({ connectionId: connection.id }),
    /not active/,
  );
});

test("Akoya 403 after refresh marks connection needs_reauth", async (t) => {
  await useTempDatabase(t);
  resetProviderState();
  installProviderClientMocks(t);
  const authorization = service.createAkoyaAuthorizationUrl("fidelity");
  const connection = await service.handleAkoyaCallback({
    code: "oauth-code",
    state: authorization.state,
  });
  akoyaState.balances = Object.assign(new Error("Akoya returned 403"), { status: 403 });

  await assert.rejects(
    service.syncProviderConnections({ connectionId: connection.id }),
    /403/,
  );

  const statusRow = getDb()
    .prepare("SELECT status FROM provider_connections WHERE id = ?")
    .get(connection.id) as StatusRow;
  assert.equal(statusRow.status, "needs_reauth");
});
