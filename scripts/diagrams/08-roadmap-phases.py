"""
Writz Protocol — 08 Roadmap Phases
Horizontal timeline: Phase 0 → 1 → 2 → 3 with status and key deliverables.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from _style import *
import graphviz

g = graphviz.Digraph("roadmap-phases")
g.attr(**base_graph_attr(
    rankdir="LR",
    splines="ortho",
    size="18,6",
    label=hl(
        "Writz Protocol — Roadmap",
        "Phase 0 complete · Phase 1 in progress · Mainnet target Q4 2026",
    ),
))
g.attr("node", **base_node_attr(width="2.8", height="1.0"))
g.attr("edge", **base_edge_attr(penwidth="2.5", arrowsize="1.1"))

# ── Phase nodes ───────────────────────────────────────────────────────────────
g.node("p0", hl(
    "Phase 0 · Research",
    "Jun 2026  ·  COMPLETE",
    "SPV feasibility · ZK design · P2WSH prototype",
), fillcolor=F_SUCCESS, color=B_SUCCESS)

g.node("p1", hl(
    "Phase 1 · Foundation",
    "Jul – Sep 2026  ·  IN PROGRESS",
    "4 contracts live · 268 tests · SCF application",
), fillcolor=F_DECISION, color=B_DECISION)

g.node("p2", hl(
    "Phase 2 · Launch",
    "Q4 2026",
    "Mainnet · audit · frontend · first real deposit",
), fillcolor=F_STELLAR, color=B_STELLAR)

g.node("p3", hl(
    "Phase 3 · Scale",
    "2027",
    "Dark Swap · BTC Savings · ZK PoR · WRTZ token",
), fillcolor=F_ZK, color=B_ZK)

# ── Connections ───────────────────────────────────────────────────────────────
g.edge("p0", "p1", color=B_SUCCESS, penwidth="2.5")
g.edge("p1", "p2", color=B_DECISION, penwidth="2.5")
g.edge("p2", "p3", color=B_STELLAR, penwidth="2.5")

with g.subgraph() as s:
    s.attr(rank="same")
    s.node("p0")
    s.node("p1")
    s.node("p2")
    s.node("p3")

render(g, "08-roadmap-phases")
