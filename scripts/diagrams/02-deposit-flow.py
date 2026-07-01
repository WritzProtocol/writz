"""
Writz Protocol — 02 Deposit Flow
Step-by-step: BTC funding → SPV proof → ZK proof → commitment insert.
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
        "Writz Protocol — Deposit Flow",
        "BTC locked on Bitcoin · ZK commitment registered on Soroban · 6-step process",
    ),
))
g.attr("node", **base_node_attr())
g.attr("edge", **base_edge_attr())

# ── Steps ─────────────────────────────────────────────────────────────────────
g.node("s1", hl("① Connect Wallets", "Stellar wallet (Freighter)", "Bitcoin wallet (Xverse)"),
       fillcolor=F_FRONTEND, color=B_FRONTEND)

g.node("s2", hl("② Derive P2WSH Address", "protocolPubkey + userBtcPubkey + timelockHeight", "Deterministic · unique per user"),
       fillcolor=F_BITCOIN, color=B_BITCOIN)

g.node("s3", hl("③ Fund P2WSH", "User sends BTC via Xverse", "Minimum 0.001 BTC · testnet"),
       fillcolor=F_BITCOIN, color=B_BITCOIN)

g.node("btc_confirm", hl("Bitcoin Confirmation", "6 blocks required", "~60 minutes on mainnet"),
       fillcolor=F_DECISION, color=B_DECISION, shape="diamond")

g.node("s4", hl("④ SPV Proof", "Relayer polls Bitcoin blocks", "Returns headers + merkle path + raw tx"),
       fillcolor=F_RELAYER, color=B_RELAYER)

g.node("s5", hl("⑤ ZK Proof (browser)", "snarkjs · Groth16 · deposit circuit", "Inputs: collateral · secret · nonce · txid_lo/hi"),
       fillcolor=F_ZK, color=B_ZK)

g.node("s5b", hl("Commitment", "Poseidon(collateral, 0, secret, nonce)", "Never leaves the browser"),
       fillcolor=F_ZK, color=B_ZK, shape="note")

g.node("s6", hl("⑥ deposit() on-chain", "commitment-tree contract", "Verifies SPV + ZK proof · emits DepositEvent"),
       fillcolor=F_STELLAR, color=B_STELLAR)

g.node("s7", hl("⑦ insert_commitment()", "Admin-signed (Phase 1 trusted relay)", "Inserts commitment · updates Merkle root"),
       fillcolor=F_RELAYER, color=B_RELAYER)

g.node("done", hl("Position Active", "status: active · debt: 0", "Ready to borrow USDC"),
       fillcolor=F_SUCCESS, color=B_SUCCESS)

# ── Edges ─────────────────────────────────────────────────────────────────────
g.edge("s1", "s2", color=B_AMBER, penwidth="2")
g.edge("s2", "s3", label="tb1q… P2WSH address", color=B_BITCOIN, fontcolor=B_BITCOIN, penwidth="2")
g.edge("s3", "btc_confirm", color=B_BITCOIN, penwidth="2")
g.edge("btc_confirm", "s4", label="confirmed", color=B_SUCCESS, fontcolor=B_SUCCESS, penwidth="2")
g.edge("btc_confirm", "s3", label="pending", style="dashed", color=B_DECISION, fontcolor=B_DECISION)
g.edge("s4", "s5", label="rawTxNoWitness → txid_lo / txid_hi", color=B_RELAYER, fontcolor=B_RELAYER)
g.edge("s5", "s5b", style="dashed", color=B_ZK)
g.edge("s5", "s6", label="proof + publicSignals", color=B_ZK, fontcolor=B_ZK, penwidth="2")
g.edge("s6", "s7", label="commitment hex", color=B_STELLAR, penwidth="2")
g.edge("s7", "done", color=B_AMBER, penwidth="2.5",
       label="new Merkle root on-chain")

render(g, "02-deposit-flow")
