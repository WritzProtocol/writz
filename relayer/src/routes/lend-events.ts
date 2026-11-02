import { Router, type Request, type Response } from "express";
import { archiveLines, type ArchiveTarget } from "../lend-events/archive-file.js";
import type { LendEventRow } from "../lend-events/store.js";
import { rateLimit } from "../rate-limit.js";

export interface LendEventsRouterDeps {
  /** Empty when WRITZ_LEND_ID is not set; the route then answers 503. */
  target: ArchiveTarget;
  /** The archive's rows and cursor, read in one transaction. */
  snapshot: () => { rows: LendEventRow[]; cursor: string | null };
  now?: () => number;
}

/**
 * GET /lend-events/export   the event archive as NDJSON, for a rebuild past RPC retention
 *
 * Public on purpose: the file proves nothing by itself, a rebuild checks it
 * against the chain, and every event in it is already public on Stellar. The
 * limit is there because one answer is the whole archive.
 */
export function createLendEventsRouter(deps: LendEventsRouterDeps): Router {
  const router = Router();
  const exports = rateLimit({
    name: "lend-events-export",
    limit: 6,
    windowMs: 60 * 60_000,
    ...(deps.now ? { now: deps.now } : {}),
    body: (retryAfterSeconds) => ({
      error: "rate_limited",
      message: "the archive export is limited per address; try again later",
      retryAfterSeconds,
    }),
  });

  router.get("/export", exports, (_req: Request, res: Response) => {
    if (!deps.target.contractId) {
      res.status(503).json({ error: "lending_not_configured", message: "WRITZ_LEND_ID is not set on this relayer" });
      return;
    }
    const snapshot = deps.snapshot();
    if (!snapshot.cursor) {
      res.status(503).json({ error: "archive_empty", message: "the archive has not read the chain yet" });
      return;
    }
    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="writz-lend-events.ndjson"');
    res.setHeader("Cache-Control", "no-store");
    const lines = archiveLines(snapshot, deps.target);
    // Writes until the socket buffer is full, then waits for it to drain.
    // `next()` by hand: leaving a for-of early would close the generator.
    const pump = () => {
      for (let next = lines.next(); !next.done; next = lines.next()) {
        if (!res.write(next.value + "\n")) {
          res.once("drain", pump);
          return;
        }
      }
      res.end();
    };
    pump();
  });

  return router;
}
