"""
Writz Protocol - 03 Borrow / Repay Flow
writz-lend: oracle-priced collateral check on borrow, partial or full repay.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from _style import *
import graphviz

g = graphviz.Digraph("borrow-repay-flow")
g.attr(**base_graph_attr(
    rankdir="TB",
    splines="spline",
    size="14,12",
    label=hl(
        "Writz Protocol - Borrow / Repay Flow",
        "writz-lend · plaintext positions · interest accrued before every action",
    ),
))
g.attr("node", **base_node_attr())
g.attr("edge", **base_edge_attr())

g.node("position", hl("Active Position (on chain)", "writz-lend · keyed by Bitcoin txid", "btc_satoshis · usdc_debt · depositor"),
       fillcolor=F_STELLAR, color=B_STELLAR)
g.node("action", hl("User Action", "Borrow USDC  or  Repay USDC", "Signed with the Stellar wallet"),
       fillcolor=F_FRONTEND, color=B_FRONTEND)

with g.subgraph(name="cluster_borrow") as b:
    b.attr(**cluster_attr("Borrow", B_STELLAR))
    b.node("b_tx", hl("writz-lend.borrow(txid, amount)", "Only the depositor · accrues interest first", "Checks liquidity + 50,000 USDC total cap"),
           fillcolor=F_STELLAR, color=B_STELLAR)
    b.node("b_ratio", hl("Collateral Ratio Check", "btc_satoshis × Reflector BTC/USD / (debt + amount) ≥ 150%", "Enforced by the contract"),
           fillcolor=F_DECISION, color=B_DECISION)
    b.node("b_usdc", hl("USDC → User Wallet", "Stellar USDC transfer", "writz-lend pool → borrower"),
           fillcolor=F_SUCCESS, color=B_SUCCESS)

with g.subgraph(name="cluster_repay") as r:
    r.attr(**cluster_attr("Repay", B_DANGER))
    r.node("r_tx", hl("writz-lend.repay(txid, amount)", "Accrues interest first", "amount ≤ outstanding debt"),
           fillcolor=F_STELLAR, color=B_STELLAR)
    r.node("r_usdc", hl("USDC ← User Wallet", "Stellar USDC transfer", "repayer → writz-lend pool"),
           fillcolor=F_DEFAULT, color=B_DEFAULT)
    r.node("r_partial", hl("Partial repay", "emits repay", "position stays active"),
           fillcolor=F_DEFAULT, color=B_DEFAULT)
    r.node("r_full", hl("Full repay", "emits repay_full · status: Closed", "relayer co-signs the BTC release"),
           fillcolor=F_SUCCESS, color=B_SUCCESS)

g.edge("position", "action", color=B_AMBER, penwidth="2")
g.edge("action", "b_tx", label="borrow", color=B_STELLAR, fontcolor=B_STELLAR, penwidth="2")
g.edge("action", "r_tx", label="repay", color=B_DANGER, fontcolor=B_DANGER, penwidth="2")
g.edge("b_tx", "b_ratio", color=B_STELLAR)
g.edge("b_ratio", "b_usdc", label="passes", color=B_SUCCESS, fontcolor=B_SUCCESS)
g.edge("r_tx", "r_usdc", color=B_DANGER)
g.edge("r_usdc", "r_partial", label="debt > 0", color=B_DEFAULT)
g.edge("r_usdc", "r_full", label="debt = 0", color=B_SUCCESS, fontcolor=B_SUCCESS, penwidth="2")

render(g, "03-borrow-repay-flow")
