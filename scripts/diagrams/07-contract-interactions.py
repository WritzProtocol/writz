"""
Writz Protocol — 07 Contract Interactions
The four Soroban contracts and how they call each other.
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
        "Writz Protocol — Soroban Contract Interactions",
        "Four live contracts on testnet · all ZK verification goes through zk-verifier",
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
    a.node("keeper", hl("Keeper", "Liquidation bot", "liquidate()"),
           fillcolor=F_DANGER, color=B_DANGER)
    a.node("admin", hl("Admin", "ADMIN_SECRET (Phase 1)", "insert_commitment()"),
           fillcolor=F_RELAYER, color=B_RELAYER)

# ── Contracts ─────────────────────────────────────────────────────────────────
g.node("bitcoin_spv",
       hl("bitcoin-spv", "CAE5L7BO2GNF7…", "verify_spv_proof(headers, merkle_proof, raw_tx)"),
       fillcolor=F_BITCOIN, color=B_BITCOIN)

g.node("zk_verifier",
       hl("zk-verifier", "CDV45GLXG4AOU6…", "verify_deposit · verify_borrow_repay · verify_liquidation"),
       fillcolor=F_ZK, color=B_ZK)

g.node("commitment_tree",
       hl("commitment-tree", "CDFAP3J4WLFZC2…", "deposit · borrow · repay · liquidate\ninsert_commitment · get_merkle_root"),
       fillcolor=F_STELLAR, color=B_STELLAR)

g.node("private_lend",
       hl("private-lend", "CCLH2GJYG3QSHZ…", "supply_usdc · withdraw_supply\nborrow_usdc · repay_usdc"),
       fillcolor=F_STELLAR, color=B_STELLAR)

g.node("usdc_token",
       hl("USDC Token (SAC)", "Stellar Asset Contract", "SEP-41 · 7 decimals (stroops)"),
       fillcolor=F_DEFAULT, color=B_DEFAULT)

# ── Actor → contract ──────────────────────────────────────────────────────────
g.edge("borrower", "commitment_tree",
       label="deposit() · borrow() · repay()", color=B_STELLAR, fontcolor=B_STELLAR, penwidth="2")
g.edge("lender", "private_lend",
       label="supply_usdc() · withdraw_supply()", color=B_STELLAR, fontcolor=B_STELLAR)
g.edge("keeper", "commitment_tree",
       label="liquidate()", color=B_DANGER, fontcolor=B_DANGER)
g.edge("admin", "commitment_tree",
       label="insert_commitment()", style="dashed", color=B_RELAYER, fontcolor=B_RELAYER)

# ── commitment-tree → others ──────────────────────────────────────────────────
g.edge("commitment_tree", "bitcoin_spv",
       label="verify_spv_proof()", color=B_BITCOIN, fontcolor=B_BITCOIN)
g.edge("commitment_tree", "zk_verifier",
       label="verify_deposit()\nverify_borrow_repay()\nverify_liquidation()",
       color=B_ZK, fontcolor=B_ZK, penwidth="2")
g.edge("commitment_tree", "private_lend",
       label="borrow_usdc() · repay_usdc()", color=B_STELLAR, fontcolor=B_STELLAR, penwidth="2")

# ── private-lend → USDC ───────────────────────────────────────────────────────
g.edge("private_lend", "usdc_token",
       label="transfer()", color=B_DEFAULT)
g.edge("usdc_token", "lender",
       label="supply / withdrawal", style="dashed", color=B_DEFAULT)
g.edge("usdc_token", "borrower",
       label="borrowed USDC", style="dashed", color=B_SUCCESS, fontcolor=B_SUCCESS)

render(g, "07-contract-interactions")
