import Database from "better-sqlite3";
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ARCHIVE_DIRECTORY = path.resolve("data", "archive");
const TEST_DATABASE_PATH = path.resolve(
  "data",
  "testing",
  "archive-transactions.db",
);

interface ArchiveCandidate {
  path: string;
  modifiedAt: number;
  transactionCount: number;
}

function inspectArchive(archivePath: string): ArchiveCandidate {
  const db = new Database(archivePath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error(`Archive failed SQLite integrity check: ${archivePath}`);
    }

    const hasTransactionsTable = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transactions'",
      )
      .get();
    if (!hasTransactionsTable) {
      throw new Error(`Archive has no transactions table: ${archivePath}`);
    }

    const row = db
      .prepare("SELECT COUNT(*) AS count FROM transactions")
      .get() as { count: number };

    return {
      path: archivePath,
      modifiedAt: statSync(archivePath).mtimeMs,
      transactionCount: row.count,
    };
  } finally {
    db.close();
  }
}

function resolveArchivePath(argument: string | undefined): ArchiveCandidate {
  if (argument) {
    const explicitPath = path.resolve(argument);
    const candidate = inspectArchive(explicitPath);
    if (candidate.transactionCount === 0) {
      throw new Error(`Archive contains no transactions: ${explicitPath}`);
    }
    return candidate;
  }

  const candidates = readdirSync(ARCHIVE_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".bak"))
    .map((entry) => inspectArchive(path.join(ARCHIVE_DIRECTORY, entry.name)))
    .filter((candidate) => candidate.transactionCount > 0)
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  const latest = candidates[0];
  if (!latest) {
    throw new Error(
      `No transaction-bearing .bak archives found in ${ARCHIVE_DIRECTORY}`,
    );
  }
  return latest;
}

function prepareTestDatabase(candidate: ArchiveCandidate): void {
  mkdirSync(path.dirname(TEST_DATABASE_PATH), { recursive: true });
  rmSync(`${TEST_DATABASE_PATH}-wal`, { force: true });
  rmSync(`${TEST_DATABASE_PATH}-shm`, { force: true });
  copyFileSync(candidate.path, TEST_DATABASE_PATH);

  console.log(`Archive: ${candidate.path}`);
  console.log(`Transactions: ${candidate.transactionCount}`);
  console.log(`Disposable database: ${TEST_DATABASE_PATH}`);
}

const argumentsWithoutFlags = process.argv
  .slice(2)
  .filter((argument) => argument !== "--prepare-only");
if (argumentsWithoutFlags.length > 1) {
  throw new Error("Usage: npm run dev:archive -- [archive-path] [--prepare-only]");
}

const candidate = resolveArchivePath(argumentsWithoutFlags[0]);
prepareTestDatabase(candidate);

if (!process.argv.includes("--prepare-only")) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["run", "dev"], {
    env: {
      ...process.env,
      LOCALFIN_DB_PATH: TEST_DATABASE_PATH,
    },
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
