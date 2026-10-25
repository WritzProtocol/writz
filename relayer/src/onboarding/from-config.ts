/**
 * Builds the onboarding funnel from the relayer's configuration. Kept apart
 * from `funnel.ts` so its tests never open the sqlite store or read the
 * environment.
 */
import { config } from "../config.js";
import { readPositionFacts, type LedgerEntriesServer } from "../lend/deposit-reads.js";
import { OnboardingFunnel, type PositionReader } from "./funnel.js";
import { openSqliteFunnelStore } from "./sqlite-store.js";

/** Display byte order (explorers, the app) to internal byte order (writz-lend storage). */
const internal = (display: string) => Buffer.from(display, "hex").reverse().toString("hex");

export function onboardingFunnelFromConfig(): OnboardingFunnel {
  const contractId = config.writzLendId;
  let server: LedgerEntriesServer | undefined;
  const readPosition: PositionReader | undefined = contractId
    ? async (txid) => {
        if (!server) {
          // Required lazily, as in routes/deposit-status.ts.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { rpc } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
          server = new rpc.Server(config.stellarRpcUrl, {
            allowHttp: config.stellarRpcUrl.startsWith("http://"),
          }) as unknown as LedgerEntriesServer;
        }
        return readPositionFacts(server, contractId, internal(txid));
      }
    : undefined;
  return new OnboardingFunnel({
    store: openSqliteFunnelStore(),
    ...(readPosition ? { readPosition } : {}),
    contractId: contractId || null,
  });
}
