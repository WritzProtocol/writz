import type { Metadata } from "next";
import { getPoolState } from "@/lib/contracts/commitmentTree";
import { earnApi } from "@/lib/earn/api";
import { getRetentionCohorts, getTvlMetrics } from "@/lib/metrics/api";
import type { Read } from "@/lib/loan/model";
import { ProtocolView } from "@/components/protocol/ProtocolView";
import type { ProtocolData } from "@/components/protocol/model";
import "../home.css";
import "../funds.css";
import "../protocol.css";

// The metrics API reads with `no-store`, so this always renders per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Protocol | Writz",
  alternates: { canonical: "/protocol" },
};

const settle = <T,>(p: Promise<T>): Promise<Read<T>> =>
  p.then(
    (value): Read<T> => ({ kind: "ok", value }),
    (): Read<T> => ({ kind: "failed" }),
  );

async function readProtocol(): Promise<ProtocolData> {
  const [pool, tvl, apy, cohorts] = await Promise.all([
    settle(getPoolState()),
    settle(getTvlMetrics()),
    settle(earnApi().getApy()),
    settle(getRetentionCohorts()),
  ]);
  const vault: ProtocolData["vault"] =
    tvl.kind === "ok"
      ? { kind: "ok", value: { totalStroops: tvl.value.onChainTvlStroops, depositors: tvl.value.uniqueDepositors, apy: apy.kind === "ok" ? apy.value : null } }
      : { kind: "failed" };
  return { pool, vault, cohorts, at: Date.now() };
}

export default async function Protocol() {
  return <ProtocolView data={await readProtocol()} />;
}
