import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MIN_CONFIRMATIONS } from "@/lib/mock/fixtures";
import { getScenario } from "@/lib/mock/scenarios";
import { mockStatusSource } from "@/lib/mock/source";
import { StatusProvider, usePositionStatus } from "./provider";
import { createStatusStore, statusKey } from "./store";
import type { LocalInputs } from "./types";

const NOW = 1_800_000_000_000;

function Probe({ local }: { local: LocalInputs }) {
  const d = usePositionStatus(local);
  return <li>{[d.status.kind, d.reclaimable && "reclaimable", d.syncing && "syncing"].filter(Boolean).join(" ")}</li>;
}

async function renderScenario(id: string): Promise<string> {
  const world = getScenario(id)!.build(NOW);
  const store = createStatusStore(mockStatusSource(world), { minConfirmations: MIN_CONFIRMATIONS, now: () => NOW });
  await Promise.all(world.positions.map((p) => store.refresh(statusKey(p.local)!, p.local)));
  return renderToStaticMarkup(
    <StatusProvider store={store}>
      <ul>
        {world.positions.map((p) => (
          <Probe key={statusKey(p.local)} local={p.local} />
        ))}
      </ul>
    </StatusProvider>,
  );
}

describe("StatusProvider with mock scenarios", () => {
  test("renders the derived status of every position in a scenario", async () => {
    expect(await renderScenario("H15")).toBe("<ul><li>active</li><li>liquidated</li></ul>");
    expect(await renderScenario("H6")).toBe("<ul><li>confirming</li></ul>");
    expect(await renderScenario("L20")).toBe("<ul><li>closed_on_chain</li></ul>");
  });

  test("renders the overlays", async () => {
    expect(await renderScenario("H16")).toBe("<ul><li>repaid_locked reclaimable</li></ul>");
    expect(await renderScenario("L12")).toBe("<ul><li>active syncing</li></ul>");
  });

  test("a position not yet read renders as checking", () => {
    const world = getScenario("H10")!.build(NOW);
    const store = createStatusStore(mockStatusSource(world), { minConfirmations: MIN_CONFIRMATIONS });
    const html = renderToStaticMarkup(
      <StatusProvider store={store}>
        <Probe local={world.positions[0].local} />
      </StatusProvider>,
    );
    expect(html).toBe("<li>checking</li>");
  });

  test("the hook needs a provider", () => {
    const world = getScenario("H10")!.build(NOW);
    expect(() => renderToStaticMarkup(<Probe local={world.positions[0].local} />)).toThrow("StatusProvider");
  });
});
