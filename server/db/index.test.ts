import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { closeDbForTests, getDb } from "./index.js";
import { MIGRATIONS, runMigrations } from "./migrations.js";

function temporaryDatabasePath(prefix: string): { directory: string; file: string } {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  return { directory, file: path.join(directory, "budget.db") };
}

function withDatabasePath(file: string, callback: () => void): void {
  const previous = process.env.LOCALFIN_DB_PATH;
  process.env.LOCALFIN_DB_PATH = file;
  try {
    callback();
  } finally {
    closeDbForTests();
    if (previous === undefined) delete process.env.LOCALFIN_DB_PATH;
    else process.env.LOCALFIN_DB_PATH = previous;
  }
}

function queryCount(database: Database.Database, sql: string): number {
  const row = database.prepare(sql).get();
  assert.ok(
    row &&
      typeof row === "object" &&
      "count" in row &&
      typeof row.count === "number",
  );
  return row.count;
}

void test("empty bootstrap records the exact ordered migration ledger and seeds idempotently", () => {
  const fixture = temporaryDatabasePath("localfin-ledger-");
  try {
    withDatabasePath(fixture.file, () => {
      const database = getDb();
      assert.deepEqual(
        database
          .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
          .all(),
        MIGRATIONS.map(({ version, name }) => ({ version, name })),
      );
      assert.equal(
        queryCount(
          database,
          "SELECT count(*) AS count FROM categories WHERE is_system = 1",
        ),
        2,
      );
      runMigrations(database);
      assert.equal(
        queryCount(database, "SELECT count(*) AS count FROM schema_migrations"),
        MIGRATIONS.length,
      );
    });
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

void test("runner rolls back the complete pending batch when a later migration fails", () => {
  const database = new Database(":memory:");
  try {
    assert.throws(
      () =>
        runMigrations(database, [
          {
            version: 1,
            name: "first",
            up(db) {
              db.exec("CREATE TABLE rolled_back (id INTEGER PRIMARY KEY); INSERT INTO rolled_back VALUES (1)");
            },
          },
          {
            version: 2,
            name: "failure",
            up() {
              throw new Error("synthetic failure");
            },
          },
        ]),
      /synthetic failure/,
    );
    assert.equal(
      queryCount(
        database,
        "SELECT count(*) AS count FROM sqlite_master WHERE name IN ('rolled_back', 'schema_migrations')",
      ),
      0,
    );
  } finally {
    database.close();
  }
});

void test("future ledger rejection performs no seed and leaves startup retryable", () => {
  const fixture = temporaryDatabasePath("localfin-ledger-retry-");
  try {
    const setup = new Database(fixture.file);
    setup.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO schema_migrations (version, name) VALUES (99, 'future');
    `);
    setup.close();

    withDatabasePath(fixture.file, () => {
      assert.throws(() => getDb(), /gap|future/i);
      const inspect = new Database(fixture.file);
      assert.equal(
        queryCount(
          inspect,
          "SELECT count(*) AS count FROM sqlite_master WHERE name = 'categories'",
        ),
        0,
      );
      inspect.prepare("DELETE FROM schema_migrations").run();
      inspect.close();
      assert.doesNotThrow(() => getDb());
    });
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

void test("ledger rejects registered-name mismatches and version gaps", () => {
  for (const [label, rows, matcher] of [
    ["name", [[1, "wrong"]], /name mismatch/],
    ["gap", [[2, "core-compatibility"]], /version gap/],
  ] as const) {
    const database = new Database(":memory:");
    try {
      database.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      const insert = database.prepare(
        "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
      );
      for (const row of rows) insert.run(...row);
      assert.throws(() => runMigrations(database), matcher, label);
    } finally {
      database.close();
    }
  }
});

