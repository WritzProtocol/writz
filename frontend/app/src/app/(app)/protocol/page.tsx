import type { Metadata } from "next";
import { getPoolState } from "@/lib/contracts/commitmentTree";
import { earnApi } from "@/lib/earn/api";
import { getRetentionCohorts, getTvlMetrics } from "@/lib/metrics/api";
import type { Read } from "@/lib/loan/model";
import { ProtocolView } from "@/components/protocol/ProtocolView";
import { mockProtocolData, type ProtocolData } from "@/components/protocol/model";
import { UI_MOCK, scenarioFromSearch } from "@/lib/mock/gate";
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

function harnessProtocol(id: string | string[] | undefined): ProtocolData | null {
  const scenario = typeof id === "string" ? scenarioFromSearch(`?scenario=${encodeURIComponent(id)}`, UI_MOCK) : null;
  const now = Date.now();
  return scenario ? mockProtocolData(scenario.build(now), now) : null;
}

export default async function Protocol({ searchParams }: { searchParams: Promise<{ scenario?: string | string[] }> }) {
  const harness = UI_MOCK ? harnessProtocol((await searchParams).scenario) : null;
  return <ProtocolView data={harness ?? (await readProtocol())} />;
}
