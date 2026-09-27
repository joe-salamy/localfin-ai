// Default locations for user-facing files: the exchange folder synced to the
// laptop with lfin-sync (see AGENTS.md). Same absolute path on both hosts.
import os from "node:os";
import path from "node:path";

const EXCHANGE_DIRECTORY = path.join(os.homedir(), "Documents", "LocalFin");

export const REPORTS_DIRECTORY = path.join(EXCHANGE_DIRECTORY, "reports");
export const INBOX_DIRECTORY = path.join(EXCHANGE_DIRECTORY, "inbox");
