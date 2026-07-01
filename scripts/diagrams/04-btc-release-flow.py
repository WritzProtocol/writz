"""
Writz Protocol — 04 BTC Release Flow
Path A cooperative release: PSBT built in browser, co-signed by protocol, finalized and broadcast.
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
        "Writz Protocol — BTC Release Flow (Path A)",
        "After full repay · cooperative co-sign · witness: [user_sig, protocol_sig, 0x01, redeemScript]",
    ),
))
g.attr("node", **base_node_attr())
g.attr("edge", **base_edge_attr())

g.node("prereq", hl("Prerequisite", "position.status = closed", "Full debt repaid · commitment spent"),
       fillcolor=F_SUCCESS, color=B_SUCCESS)

g.node("build_psbt", hl("Build Release PSBT", "browserside · bitcoinjs-lib", "txid + vout + redeemScript + recipient + fee"),
       fillcolor=F_FRONTEND, color=B_FRONTEND)

g.node("cosign_req", hl("POST /api/cosign", "{ psbt, commitment, stellarAddress }", "Server verifies commitment on-chain"),
       fillcolor=F_RELAYER, color=B_RELAYER)

g.node("on_chain_check", hl("On-Chain Check", "is_commitment_pending(commitment) == false", "Proves commitment is in the Merkle tree"),
       fillcolor=F_STELLAR, color=B_STELLAR)

g.node("protocol_sign", hl("Protocol Co-Sign", "PROTOCOL_SIGNING_KEY (WIF · server-only)", "ECPair.fromWIF → psbt.signInput(0, keypair)"),
       fillcolor=F_RELAYER, color=B_RELAYER)

g.node("user_sign", hl("User Signs PSBT", "Xverse · sats-connect", "signPsbt({ psbt, signInputs: { '0': [0] } })"),
       fillcolor=F_BITCOIN, color=B_BITCOIN)

g.node("finalize", hl("finalizePathA()", "Merge partial signatures", "Witness: [user_sig, protocol_sig, 0x01, redeemScript]"),
       fillcolor=F_FRONTEND, color=B_FRONTEND)

g.node("broadcast", hl("Broadcast to Bitcoin", "POST Esplora /tx", "Returns Bitcoin txid"),
       fillcolor=F_BITCOIN, color=B_BITCOIN)

g.node("done", hl("BTC Released", "Collateral returned to user", "Loan fully closed"),
       fillcolor=F_SUCCESS, color=B_SUCCESS)

# ── Edges ─────────────────────────────────────────────────────────────────────
g.edge("prereq", "build_psbt", color=B_AMBER, penwidth="2")
g.edge("build_psbt", "cosign_req", label="unsigned PSBT (base64)", color=B_RELAYER, fontcolor=B_RELAYER, penwidth="2")
g.edge("cosign_req", "on_chain_check", style="dashed", color=B_STELLAR)
g.edge("on_chain_check", "protocol_sign", label="eligible", color=B_SUCCESS, fontcolor=B_SUCCESS)
g.edge("protocol_sign", "cosign_req", label="signedPsbt", style="dashed", color=B_RELAYER)
g.edge("cosign_req", "user_sign", label="{ signedPsbt }", color=B_RELAYER, fontcolor=B_RELAYER, penwidth="2")
g.edge("build_psbt", "user_sign", label="original PSBT", style="dashed", color=B_DEFAULT)
g.edge("user_sign", "finalize", label="user-signed PSBT", color=B_BITCOIN, fontcolor=B_BITCOIN, penwidth="2")
g.edge("cosign_req", "finalize", label="protocol-signed PSBT", color=B_RELAYER, fontcolor=B_RELAYER)
g.edge("finalize", "broadcast", label="signed tx hex", color=B_AMBER, fontcolor=B_AMBER, penwidth="2.5")
g.edge("broadcast", "done", color=B_AMBER, penwidth="2.5")

render(g, "04-btc-release-flow")
