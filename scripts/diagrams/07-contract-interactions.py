"""
Writz Protocol - 07 Contract Interactions
Writz v1 contracts (bitcoin-spv + writz-lend) and how they call each other.
Contract IDs: contracts/deployments/testnet.md (2026-10-25 redeploy).
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from _style import *
import graphviz

g = graphviz.Digraph("contract-interactions")
g.attr(**base_graph_attr(
    rankdir="TB",
    splines="spline",
    size="14,10",
    label=hl(
        "Writz Protocol - Soroban Contract Interactions (v1)",
        "bitcoin-spv + writz-lend on testnet · USDC SAC · Reflector oracle · relayer",
    ),
))
g.attr("node", **base_node_attr())
g.attr("edge", **base_edge_attr())

# ── External actors ────────────────────────────────────────────────────────────
with g.subgraph(name="cluster_actors") as a:
    a.attr(**cluster_attr("External Actors", B_FRONTEND))
    a.node("borrower", hl("Borrower", "Stellar address", "deposit · borrow · repay"),
           fillcolor=F_FRONTEND, color=B_FRONTEND)
    a.node("lender", hl("Lender", "Stellar address", "supply_usdc · withdraw_supply"),
           fillcolor=F_FRONTEND, color=B_FRONTEND)
    a.node("keeper", hl("Keeper", "Designated · anyone after 24h stale", "liquidate()"),
           fillcolor=F_DANGER, color=B_DANGER)
    a.node("relayer", hl("Relayer", "Header submitter · repay watcher", "submit headers · publish_release_psbt()"),
           fillcolor=F_RELAYER, color=B_RELAYER)

# ── v1 contracts ──────────────────────────────────────────────────────────────
with g.subgraph(name="cluster_v1") as v:
    v.attr(**cluster_attr("Writz v1", B_STELLAR, "Plaintext positions"))
    v.node("writz_lend",
           hl("writz-lend", "CD3BRE32LDNDHAEV… · deposit · supply_usdc · withdraw_supply · borrow · repay",
              "liquidate · publish_release_psbt · get_release_psbt"),
           fillcolor=F_STELLAR, color=B_STELLAR, penwidth="2.2")
    v.node("bitcoin_spv",
           hl("bitcoin-spv", "CBX23YKCCJMAMBMS…", "verify_transaction · consume_deposit"),
           fillcolor=F_BITCOIN, color=B_BITCOIN)
    v.node("usdc_token",
           hl("USDC Token (SAC)", "Stellar Asset Contract", "SEP-41 · 7 decimals (stroops)"),
           fillcolor=F_DEFAULT, color=B_DEFAULT)
    v.node("oracle",
           hl("Reflector Oracle", "SEP-40 · BTC/USD", "lastprice · decimals"),
           fillcolor=F_DEFAULT, color=B_DEFAULT)

# ── Actor → contract ──────────────────────────────────────────────────────────
g.edge("borrower", "writz_lend", label="deposit() · borrow() · repay()",
       color=B_STELLAR, fontcolor=B_STELLAR, penwidth="2")
g.edge("lender", "writz_lend", label="supply_usdc() · withdraw_supply()",
       color=B_STELLAR, fontcolor=B_STELLAR)
g.edge("keeper", "writz_lend", label="liquidate()", color=B_DANGER, fontcolor=B_DANGER)
g.edge("relayer", "writz_lend", label="publish_release_psbt()", style="dashed",
       color=B_RELAYER, fontcolor=B_RELAYER)
g.edge("relayer", "bitcoin_spv", label="submit headers", style="dashed",
       color=B_RELAYER, fontcolor=B_RELAYER)

# ── writz-lend → others ───────────────────────────────────────────────────────
g.edge("writz_lend", "bitcoin_spv", label="verify_transaction()\nconsume_deposit()",
       color=B_BITCOIN, fontcolor=B_BITCOIN, penwidth="2")
g.edge("writz_lend", "oracle", label="lastprice()", color=B_DEFAULT)
g.edge("writz_lend", "usdc_token", label="transfer()", color=B_DEFAULT)
g.edge("usdc_token", "borrower", label="borrowed USDC", style="dashed",
       color=B_SUCCESS, fontcolor=B_SUCCESS)

render(g, "07-contract-interactions")
