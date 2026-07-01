"""
Writz Protocol — 06 Commitment State Machine
Lifecycle of a position commitment from creation to BTC release.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from _style import *
import graphviz

g = graphviz.Digraph("commitment-state-machine")
g.attr(**base_graph_attr(
    rankdir="LR",
    splines="spline",
    size="16,8",
    label=hl(
        "Writz Protocol — Commitment State Machine",
        "Each state transition requires a valid Groth16 proof · nonce rotates on every change",
    ),
))
g.attr("node", **base_node_attr())
g.attr("edge", **base_edge_attr())

# ── States ────────────────────────────────────────────────────────────────────
g.node("start", shape="circle", style="filled", fillcolor=T_DARK, color=T_DARK, width="0.3")

g.node("pending", hl("Pending", "deposit() verified on-chain", "insert_commitment() not yet called"),
       fillcolor=F_DECISION, color=B_DECISION)

g.node("active_0", hl("Active · debt=0", "Commitment in Merkle tree", "Poseidon(collateral, 0, secret, nonce)"),
       fillcolor=F_STELLAR, color=B_STELLAR)

g.node("active_d", hl("Active · debt>0", "USDC borrowed", "Poseidon(collateral, debt, secret, nonce)"),
       fillcolor=F_STELLAR, color=B_STELLAR)

g.node("closed", hl("Closed · debt=0", "Full repay complete", "Old nullifier spent · new commitment in tree"),
       fillcolor=F_SUCCESS, color=B_SUCCESS)

g.node("liquidated", hl("Liquidated", "Ratio < 120% · keeper acted", "Nullifier spent · debt repaid by keeper"),
       fillcolor=F_DANGER, color=B_DANGER)

g.node("released", hl("BTC Released", "Path A PSBT finalized", "Collateral returned on Bitcoin"),
       fillcolor=F_SUCCESS, color=B_SUCCESS, shape="doublecircle")

# ── Transitions ───────────────────────────────────────────────────────────────
g.edge("start", "pending",
       label="deposit() + ZK deposit proof", color=B_BITCOIN, fontcolor=B_BITCOIN, penwidth="2")

g.edge("pending", "active_0",
       label="insert_commitment() · admin (Phase 1)", color=B_RELAYER, fontcolor=B_RELAYER, penwidth="2")

g.edge("active_0", "active_d",
       label="borrow() · ZK borrow_repay proof · is_borrow=1", color=B_STELLAR, fontcolor=B_STELLAR, penwidth="2")

g.edge("active_d", "active_d",
       label="borrow() / partial repay() · nonce rotates", color=B_STELLAR, fontcolor=B_STELLAR, style="dashed")

g.edge("active_d", "closed",
       label="repay() full debt · ZK proof · is_borrow=0", color=B_SUCCESS, fontcolor=B_SUCCESS, penwidth="2")

g.edge("active_d", "liquidated",
       label="liquidate() · ratio < 120% · keeper proof", color=B_DANGER, fontcolor=B_DANGER, penwidth="2")

g.edge("closed", "released",
       label="Path A PSBT · /api/cosign · Xverse sign · broadcast", color=B_AMBER, fontcolor=B_AMBER, penwidth="2.5")

g.edge("active_0", "released",
       label="withdraw (no debt)", style="dashed", color=B_DEFAULT)

render(g, "06-commitment-state-machine")
