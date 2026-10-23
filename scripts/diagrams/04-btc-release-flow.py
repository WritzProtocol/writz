"""
Writz Protocol - 04 BTC Release Flow
Path A cooperative release: the relayer's repay watcher builds and co-signs the PSBT,
publishes it on writz-lend, and the user signs, finalizes and broadcasts it.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from _style import *
import graphviz

g = graphviz.Digraph("btc-release-flow")
g.attr(**base_graph_attr(
    rankdir="LR",
    splines="ortho",
    size="18,8",
    label=hl(
        "Writz Protocol - BTC Release Flow (Path A)",
        "After full repay · cooperative co-sign · witness: [user_sig, protocol_sig, 0x01, redeemScript]",
    ),
))
g.attr("node", **base_node_attr())
g.attr("edge", **base_edge_attr())

g.node("prereq", hl("Full Repayment", "writz-lend.repay() · debt = 0", "emits repay_full · status: Closed"),
       fillcolor=F_SUCCESS, color=B_SUCCESS)
g.node("watcher", hl("Repay Watcher (relayer)", "Polls Soroban RPC for repay_full", "Loads the position · rebuilds the redeem script"),
       fillcolor=F_RELAYER, color=B_RELAYER)
g.node("protocol_sign", hl("Build + Co-Sign PSBT", "Pays the user key's own address", "Protocol key (KMS, or testnet WIF)"),
       fillcolor=F_RELAYER, color=B_RELAYER)
g.node("publish", hl("writz-lend.publish_release_psbt()", "Half-signed PSBT stored on Stellar", "Retrievable even if Writz is down"),
       fillcolor=F_STELLAR, color=B_STELLAR)
g.node("fetch", hl("get_release_psbt(txid)", "Read by the app (or any client)", "No Writz service required"),
       fillcolor=F_STELLAR, color=B_STELLAR)
g.node("user_sign", hl("User Signs PSBT", "Xverse · sats-connect", "Adds the user signature"),
       fillcolor=F_BITCOIN, color=B_BITCOIN)
g.node("finalize", hl("finalizePathA()", "Merge partial signatures", "Witness: [user_sig, protocol_sig, 0x01, redeemScript]"),
       fillcolor=F_FRONTEND, color=B_FRONTEND)
g.node("broadcast", hl("Broadcast to Bitcoin", "POST Esplora /tx", "Returns Bitcoin txid"),
       fillcolor=F_BITCOIN, color=B_BITCOIN)
g.node("done", hl("BTC Released", "Collateral returned to user", "Loan fully closed"),
       fillcolor=F_SUCCESS, color=B_SUCCESS)

g.edge("prereq", "watcher", label="repay_full event", color=B_AMBER, fontcolor=B_AMBER, penwidth="2")
g.edge("watcher", "protocol_sign", color=B_RELAYER, penwidth="2")
g.edge("protocol_sign", "publish", label="protocol-signed PSBT", color=B_RELAYER, fontcolor=B_RELAYER, penwidth="2")
g.edge("publish", "fetch", style="dashed", color=B_STELLAR)
g.edge("fetch", "user_sign", label="PSBT", color=B_BITCOIN, fontcolor=B_BITCOIN, penwidth="2")
g.edge("user_sign", "finalize", label="fully signed PSBT", color=B_BITCOIN, fontcolor=B_BITCOIN, penwidth="2")
g.edge("finalize", "broadcast", label="signed tx hex", color=B_AMBER, fontcolor=B_AMBER, penwidth="2.5")
g.edge("broadcast", "done", color=B_AMBER, penwidth="2.5")

render(g, "04-btc-release-flow")
