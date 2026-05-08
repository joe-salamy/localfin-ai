import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { closeDbForTests, getDb, resolveDatabasePath } from "./index.js";

const originalDbPath = process.env.LOCALFIN_DB_PATH;
const originalDataDir = process.env.LOCALFIN_DATA_DIR;
const tempRoots: string[] = [];

function restoreEnvironment(): void {
  if (originalDbPath === undefined) {
    delete process.env.LOCALFIN_DB_PATH;
  } else {
    process.env.LOCALFIN_DB_PATH = originalDbPath;
  }

  if (originalDataDir === undefined) {
    delete process.env.LOCALFIN_DATA_DIR;
  } else {
    process.env.LOCALFIN_DATA_DIR = originalDataDir;
  }
}

afterEach(async () => {
  closeDbForTests();
  restoreEnvironment();
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("resolveDatabasePath trims an explicit database path override", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-db-path-test-"));
  tempRoots.push(tempDir);
  const expectedPath = path.join(tempDir, "custom.db");

  process.env.LOCALFIN_DB_PATH = `  ${expectedPath}  `;
  process.env.LOCALFIN_DATA_DIR = path.join(tempDir, "ignored");

  assert.equal(resolveDatabasePath(), expectedPath);
});

test("resolveDatabasePath trims the data directory override", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-data-dir-test-"));
  tempRoots.push(tempDir);
  delete process.env.LOCALFIN_DB_PATH;
  process.env.LOCALFIN_DATA_DIR = `  ${tempDir}  `;

  assert.equal(resolveDatabasePath(), path.join(tempDir, "budget.db"));
});

test("closeDbForTests allows getDb to reopen at a new isolated path", async () => {
  const firstDir = await mkdtemp(path.join(os.tmpdir(), "localfin-first-db-test-"));
  const secondDir = await mkdtemp(path.join(os.tmpdir(), "localfin-second-db-test-"));
  tempRoots.push(firstDir, secondDir);

  const firstPath = path.join(firstDir, "budget.db");
  const secondPath = path.join(secondDir, "budget.db");

  process.env.LOCALFIN_DB_PATH = firstPath;
  getDb().prepare("INSERT INTO accounts (id, name, type) VALUES (?, ?, ?)").run(
    "first-account",
    "First Account",
    "asset",
  );

  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = secondPath;
  await mkdir(secondDir, { recursive: true });
  const secondDb = getDb();
  const firstAccount = secondDb
    .prepare("SELECT 1 FROM accounts WHERE id = ?")
    .get("first-account");

  assert.equal(firstAccount, undefined);
});
