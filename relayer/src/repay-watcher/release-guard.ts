/**
 * Status check the repay watcher runs before it co-signs a release.
 *
 * Kept free of runtime imports (the `writz-lend` import is type-only) so the
 * jest suite can load it: see test/repay-watcher.test.ts on why nothing that
 * pulls in `@stellar/stellar-sdk` at module scope can be imported there.
 */
import type { Position } from "writz-lend";

/**
 * Throws unless the position is `Closed`. A `repay_full` event is only
 * emitted when `repay` closes a position, so the watcher co-signs a release
 * for a position the contract reports as closed and nothing else: an
 * `Active` or `Liquidated` position read back at handling time is refused.
 */
export function assertPositionClosed(position: Pick<Position, "status">, txidDisplay: string): void {
  const status = position.status.tag;
  if (status !== "Closed") {
    throw new Error(
      `position ${txidDisplay} is ${status}, not Closed - refusing to co-sign a release`,
    );
  }
}
