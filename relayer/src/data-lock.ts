/**
 * A marker that a relayer owns its data directory, so `rebuild-lend-state`
 * cannot swap a database out from under a running process.
 *
 * The file holds the host and PID. A marker from another host is stale: a
 * container gets a new hostname on each deploy, and its PIDs mean nothing here.
 */
import fs from "fs";
import os from "os";
import path from "path";

const LOCK_FILE = "relayer.lock";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function claimDataDir(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, LOCK_FILE), JSON.stringify({ host: os.hostname(), pid: process.pid }));
}

/** Throws if another live process on this host holds `dataDir`. */
export function assertDataDirFree(dataDir: string): void {
  let lock: { host: string; pid: number };
  try {
    lock = JSON.parse(fs.readFileSync(path.join(dataDir, LOCK_FILE), "utf8"));
  } catch {
    return;
  }
  if (lock.host === os.hostname() && lock.pid !== process.pid && isAlive(lock.pid)) {
    throw new Error(`a relayer is using ${dataDir} (pid ${lock.pid}). Stop it first.`);
  }
}
