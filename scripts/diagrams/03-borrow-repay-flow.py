"""
Writz Protocol — 03 Borrow / Repay Flow
ZK proof updates the commitment tree; USDC transferred to/from the pool.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from _style import *
import graphviz

g = graphviz.Digraph("borrow-repay-flow")
g.attr(**base_graph_attr(
    rankdir="TB",
    splines="spline",
    size="14,11",
    label=hl(
        "Writz Protocol — Borrow / Repay Flow",
        "Private ZK proof · collateral ratio enforced on-chain · nonce rotates on every action",
    ),
))
g.attr("node", **base_node_attr())
g.attr("edge", **base_edge_attr())

# ── Shared start ──────────────────────────────────────────────────────────────
g.node("position", hl("Active Position (local)", "collateral · debt · secret · nonce", "Stored in localStorage · never on-chain"),
       fillcolor=F_FRONTEND, color=B_FRONTEND)

g.node("action", hl("User Action", "Borrow USDC  or  Repay USDC", "Entered in PositionDashboard"),
       fillcolor=F_DECISION, color=B_DECISION, shape="diamond")

# ── Borrow branch ─────────────────────────────────────────────────────────────
with g.subgraph(name="cluster_borrow") as b:
    b.attr(**cluster_attr("Borrow Path", B_STELLAR, "is_borrow = 1 · delta = +amount"))
    b.node("b_ratio", hl("Collateral Ratio Check", "collateral × BTC_PRICE / (debt + amount) ≥ 150%", "Enforced by ZK circuit on-chain"),
           fillcolor=F_DECISION, color=B_DECISION)
    b.node("b_prove", hl("ZK Proof (browser)", "borrow_repay circuit · is_borrow=1", "Proves ratio · new commitment · new root"),
           fillcolor=F_ZK, color=B_ZK)
    b.node("b_tx", hl("borrow() on-chain", "commitment-tree contract", "Verifies proof · updates root · transfers USDC out"),
           fillcolor=F_STELLAR, color=B_STELLAR)
    b.node("b_usdc", hl("USDC → User Wallet", "Stellar USDC transfer", "private-lend pool → borrower"),
           fillcolor=F_SUCCESS, color=B_SUCCESS)

# ── Repay branch ──────────────────────────────────────────────────────────────
with g.subgraph(name="cluster_repay") as r:
    r.attr(**cluster_attr("Repay Path", B_STELLAR, "is_borrow = 0 · delta = FIELD_PRIME − amount"))
    r.node("r_prove", hl("ZK Proof (browser)", "borrow_repay circuit · is_borrow=0", "delta = (p − repayAmount) % p  ← field negation"),
           fillcolor=F_ZK, color=B_ZK)
    r.node("r_tx", hl("repay() on-chain", "commitment-tree contract", "Verifies proof · nullifies old commitment · USDC in"),
           fillcolor=F_STELLAR, color=B_STELLAR)
    r.node("r_usdc", hl("USDC ← User Wallet", "Stellar USDC transfer", "borrower → private-lend pool"),
           fillcolor=F_DANGER, color=B_DANGER)

# ── Shared nonce update ───────────────────────────────────────────────────────
g.node("nonce_rotate", hl("Nonce Rotation", "newNonce = randomFieldElement()", "new commitment = Poseidon(collateral, newDebt, secret, newNonce)"),
       fillcolor=F_ZK, color=B_ZK)

g.node("save", hl("Update Position Store", "new commitment · nullifier · nonce · debt", "localStorage — device only"),
       fillcolor=F_FRONTEND, color=B_FRONTEND)

# ── Edges ─────────────────────────────────────────────────────────────────────
g.edge("position", "action")
g.edge("action", "b_ratio", label="borrow", color=B_STELLAR, fontcolor=B_STELLAR, penwidth="2")
g.edge("action", "r_prove", label="repay", color=B_DANGER, fontcolor=B_DANGER, penwidth="2")

g.edge("b_ratio", "b_prove", label="passes", color=B_SUCCESS, fontcolor=B_SUCCESS)
g.edge("b_prove", "b_tx", label="proof + signals", color=B_ZK, fontcolor=B_ZK, penwidth="2")
g.edge("b_tx", "b_usdc", color=B_SUCCESS, penwidth="2")
g.edge("b_tx", "nonce_rotate", color=B_STELLAR)

g.edge("r_prove", "r_tx", label="proof + signals", color=B_ZK, fontcolor=B_ZK, penwidth="2")
g.edge("r_tx", "r_usdc", color=B_DANGER, penwidth="2")
g.edge("r_tx", "nonce_rotate", color=B_STELLAR)

g.edge("nonce_rotate", "save", color=B_AMBER, penwidth="2")

render(g, "03-borrow-repay-flow")
