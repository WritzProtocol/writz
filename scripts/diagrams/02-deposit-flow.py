"""
Writz Protocol - 02 Deposit Flow
Step-by-step: BTC funding → SPV proof → key-control signature → writz-lend.deposit().
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from _style import *
import graphviz

g = graphviz.Digraph("deposit-flow")
g.attr(**base_graph_attr(
    rankdir="LR",
    splines="ortho",
    size="18,8",
    label=hl(
        "Writz Protocol - Deposit Flow",
        "BTC locked on Bitcoin · verified by bitcoin-spv · plaintext position in writz-lend",
    ),
))
g.attr("node", **base_node_attr())
g.attr("edge", **base_edge_attr())

g.node("s1", hl("① Connect Wallets", "Stellar wallet (Freighter)", "Bitcoin wallet (Xverse)"),
       fillcolor=F_FRONTEND, color=B_FRONTEND)
g.node("s2", hl("② Derive P2WSH Address", "protocolPubkey + userBtcPubkey + timelockHeight", "Deterministic · unique per user"),
       fillcolor=F_BITCOIN, color=B_BITCOIN)
g.node("s3", hl("③ Fund P2WSH", "User sends BTC via Xverse", "Minimum 0.001 BTC"),
       fillcolor=F_BITCOIN, color=B_BITCOIN)
g.node("btc_confirm", hl("Bitcoin Confirmation", "6 blocks required", "~60 minutes"),
       fillcolor=F_DECISION, color=B_DECISION, shape="diamond")
g.node("s4", hl("④ SPV Proof", "Relayer: GET /spv-proof/:txid", "block hash + Merkle path + raw tx"),
       fillcolor=F_RELAYER, color=B_RELAYER)
g.node("s5", hl("⑤ Key-Control Signature", "Bitcoin wallet signs message (BIP-137)", "binds contract + depositor + txid"),
       fillcolor=F_BITCOIN, color=B_BITCOIN)
g.node("s6", hl("⑥ writz-lend.deposit()", "Rebuilds P2WSH · bitcoin-spv.verify_transaction", "Checks timelock + key_sig · consume_deposit"),
       fillcolor=F_STELLAR, color=B_STELLAR)
g.node("done", hl("Position Active", "keyed by Bitcoin txid · debt: 0", "Public on chain · ready to borrow USDC"),
       fillcolor=F_SUCCESS, color=B_SUCCESS)

g.edge("s1", "s2", color=B_AMBER, penwidth="2")
g.edge("s2", "s3", label="tb1q… P2WSH address", color=B_BITCOIN, fontcolor=B_BITCOIN, penwidth="2")
g.edge("s3", "btc_confirm", color=B_BITCOIN, penwidth="2")
g.edge("btc_confirm", "s4", label="confirmed", color=B_SUCCESS, fontcolor=B_SUCCESS, penwidth="2")
g.edge("btc_confirm", "s3", label="pending", style="dashed", color=B_DECISION, fontcolor=B_DECISION)
g.edge("s4", "s5", label="txid", color=B_RELAYER, fontcolor=B_RELAYER)
g.edge("s5", "s6", label="proof bundle + key_sig", color=B_STELLAR, fontcolor=B_STELLAR, penwidth="2")
g.edge("s6", "done", color=B_AMBER, penwidth="2.5", label="DepositEvent")

render(g, "02-deposit-flow")
