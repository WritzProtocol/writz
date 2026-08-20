"""
Writz Protocol - 09 Bitcoin Script
P2WSH locking script: two spending paths (cooperative co-sign vs CLTV timelock).
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from _style import *
import graphviz

g = graphviz.Digraph("bitcoin-script")
g.attr(**base_graph_attr(
    rankdir="TB",
    splines="spline",
    size="14,10",
    label=hl(
        "Writz Protocol - Bitcoin P2WSH Locking Script",
        "BTC stays on Bitcoin · no custodian · two safe spending paths",
    ),
))
g.attr("node", **base_node_attr())
g.attr("edge", **base_edge_attr())

# ── Entry point ───────────────────────────────────────────────────────────────
g.node("deposit", hl(
    "User sends BTC",
    "to P2WSH address derived per position",
    "bitcoin-script/src/address.ts",
), fillcolor=F_BITCOIN, color=B_BITCOIN)

g.node("script", hl(
    "P2WSH Redeem Script",
    "OP_IF ... OP_ELSE ... OP_ENDIF",
    "Two spending conditions encoded in Bitcoin Script",
), fillcolor=F_BITCOIN, color=B_BITCOIN, shape="diamond", width="3.2", height="1.0")

# ── Path A ────────────────────────────────────────────────────────────────────
with g.subgraph(name="cluster_path_a") as a:
    a.attr(**cluster_attr("Path A - Cooperative Release", B_SUCCESS, "Normal case: loan fully repaid"))
    a.node("repay", hl(
        "User repays USDC",
        "commitment-tree · repay() verified on-chain",
    ), fillcolor=F_SUCCESS, color=B_SUCCESS)
    a.node("cosign", hl(
        "Protocol co-signature",
        "PROTOCOL_SIGNING_KEY signs the PSBT",
        "/api/cosign · Next.js server route",
    ), fillcolor=F_STELLAR, color=B_STELLAR)
    a.node("user_sign_a", hl(
        "User signs PSBT",
        "Xverse wallet · sats-connect",
    ), fillcolor=F_FRONTEND, color=B_FRONTEND)
    a.node("btc_released", hl(
        "BTC Released",
        "Broadcast to Bitcoin · Path A witness",
        "Collateral returned to user wallet",
    ), fillcolor=F_SUCCESS, color=B_SUCCESS, shape="doubleoctagon")

# ── Path B ────────────────────────────────────────────────────────────────────
with g.subgraph(name="cluster_path_b") as b:
    b.attr(**cluster_attr("Path B - Emergency Recovery", B_DANGER, "Timelock safety fallback · no Writz needed"))
    b.node("timelock", hl(
        "CLTV Timelock Expires",
        "OP_CHECKLOCKTIMEVERIFY",
        "Locktime = loan maturity + 30 days",
    ), fillcolor=F_DANGER, color=B_DANGER)
    b.node("user_sign_b", hl(
        "User signs unilaterally",
        "No protocol signature required",
    ), fillcolor=F_FRONTEND, color=B_FRONTEND)
    b.node("btc_reclaimed", hl(
        "BTC Reclaimed",
        "Path B witness · user broadcasts",
        "Protocol unavailability protection",
    ), fillcolor=F_DANGER, color=B_DANGER, shape="doubleoctagon")

# ── Edges ─────────────────────────────────────────────────────────────────────
g.edge("deposit", "script",
       label="locked", color=B_BITCOIN, fontcolor=B_BITCOIN, penwidth="2.5")

g.edge("script", "repay",
       label="loan repaid", color=B_SUCCESS, fontcolor=B_SUCCESS)
g.edge("script", "timelock",
       label="protocol unavailable", color=B_DANGER, fontcolor=B_DANGER)

g.edge("repay", "cosign", color=B_SUCCESS)
g.edge("cosign", "user_sign_a", color=B_SUCCESS)
g.edge("user_sign_a", "btc_released",
       label="broadcast", color=B_AMBER, fontcolor=B_AMBER, penwidth="2.5")

g.edge("timelock", "user_sign_b", color=B_DANGER)
g.edge("user_sign_b", "btc_reclaimed",
       label="broadcast", color=B_DANGER, fontcolor=B_DANGER, penwidth="2.5")

render(g, "09-bitcoin-script")
