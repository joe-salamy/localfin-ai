// Default location for user-facing files: `~/Downloads`. Bank CSVs the user
// downloads are read from there, and reports / review sheets are written back
// to it. There is no separate exchange or inbox folder to sync.
import os from "node:os";
import path from "node:path";

export const DOWNLOADS_DIRECTORY = path.join(os.homedir(), "Downloads");
