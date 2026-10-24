"""
Writz Protocol - 01 System Architecture
Writz v1: Bitcoin network, relayer, Soroban contracts (bitcoin-spv + writz-lend),
and the browser. The privacy edition (in progress) is drawn as a separate group
with no edge into writz-lend.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from _style import *
import graphviz

g = graphviz.Digraph("system-architecture")
g.attr(**base_graph_attr(
    rankdir="TB",
    splines="spline",
    size="16,12",
    label=hl(
        "Writz Protocol - System Architecture (v1)",
        "Native BTC collateral verified on Stellar · plaintext positions · live on testnet",
    ),
))
g.attr("node", **base_node_attr())
g.attr("edge", **base_edge_attr())

# ── Bitcoin Network ───────────────────────────────────────────────────────────
with g.subgraph(name="cluster_bitcoin") as b:
    b.attr(**cluster_attr("Bitcoin Network", B_BITCOIN, "Collateral locked in P2WSH · never custodied by Writz"))
    b.node("btc_wallet", hl("User Bitcoin Wallet", "Xverse · sats-connect", "Funds P2WSH · signs key proof and release PSBT"),
           fillcolor=F_BITCOIN, color=B_BITCOIN)
    b.node("p2wsh", hl("P2WSH Locking Script", "Path A: protocol + user co-sign", "Path B: CLTV timelock, user alone"),
           fillcolor=F_BITCOIN, color=B_BITCOIN, shape="box")
    b.node("btc_ledger", hl("Bitcoin Ledger", "Signet / Mainnet", "Source of truth for collateral UTXOs"),
           fillcolor=F_BITCOIN, color=B_BITCOIN, shape="cylinder", penwidth="2")

# ── Relayer ───────────────────────────────────────────────────────────────────
with g.subgraph(name="cluster_relayer") as r:
    r.attr(**cluster_attr("Relayer", B_RELAYER, "Bun · Express · Esplora-backed"))
    r.node("relayer", hl("SPV Relayer", "Submits block headers · GET /spv-proof/:txid", "Merkle proof + raw tx for deposits"),
           fillcolor=F_RELAYER, color=B_RELAYER)
    r.node("repay_watcher", hl("Repay Watcher", "Listens for repay_full", "Builds + co-signs Path A release PSBT"),
           fillcolor=F_RELAYER, color=B_RELAYER)

# ── Soroban Contracts ─────────────────────────────────────────────────────────
with g.subgraph(name="cluster_soroban") as s:
    s.attr(**cluster_attr("Soroban Contracts  ·  Writz v1", B_STELLAR,
                          "bitcoin-spv + writz-lend · positions public on chain"))
    s.node("bitcoin_spv", hl("bitcoin-spv", "Header-chain light client", "verify_transaction · deposit txid registry"),
           fillcolor=F_STELLAR, color=B_STELLAR)
    s.node("writz_lend", hl("writz-lend", "Deposits · USDC pool · interest · keeper liquidation",
                            "publish_release_psbt · plaintext positions keyed by txid"),
           fillcolor=F_STELLAR, color=B_STELLAR, penwidth="2.2")
    s.node("usdc", hl("USDC (SAC)", "Circle native USDC", "SEP-41"),
           fillcolor=F_DEFAULT, color=B_DEFAULT)
    s.node("oracle", hl("Reflector Oracle", "BTC/USD · SEP-40", "single source today"),
           fillcolor=F_DEFAULT, color=B_DEFAULT)

# ── Browser / Frontend ────────────────────────────────────────────────────────
with g.subgraph(name="cluster_frontend") as f:
    f.attr(**cluster_attr("Browser  ·  Trust Boundary", B_FRONTEND, "Keys never leave the user's wallets"))
    f.node("stellar_wallet", hl("Stellar Wallet", "Freighter · stellar-wallets-kit", "Signs Soroban transactions"),
           fillcolor=F_FRONTEND, color=B_FRONTEND)
    f.node("btc_lib", hl("Bitcoin (browser)", "bitcoinjs-lib · sats-connect", "P2WSH derivation · PSBT finalize"),
           fillcolor=F_BITCOIN, color=B_BITCOIN)

# ── Privacy edition (separate, in progress) ───────────────────────────────────
with g.subgraph(name="cluster_privacy") as p:
    p.attr(**cluster_attr("Privacy edition (in progress)", B_DEFAULT,
                          "Separate, opt-in · testnet only · not part of v1 · never called by writz-lend"))
    p.attr(style="rounded,dashed")
    p.node("commitment_tree", hl("commitment-tree", "Own pool · Poseidon Merkle tree", "privacy edition"),
           fillcolor=F_DEFAULT, color=B_DEFAULT, style="filled,rounded,dashed")
    p.node("zk_verifier", hl("zk-verifier", "Groth16 / BN254", "privacy edition"),
           fillcolor=F_DEFAULT, color=B_DEFAULT, style="filled,rounded,dashed")

# ── Bitcoin flow ──────────────────────────────────────────────────────────────
g.edge("btc_wallet", "p2wsh", label="fund deposit", color=B_BITCOIN, fontcolor=B_BITCOIN, penwidth="2")
g.edge("p2wsh", "btc_ledger", penwidth="2", color=B_BITCOIN)
g.edge("btc_ledger", "relayer", label="block data", style="dashed", color=B_RELAYER, fontcolor=B_RELAYER)

# ── Relayer → Soroban ─────────────────────────────────────────────────────────
g.edge("relayer", "bitcoin_spv", label="submit headers", color=B_RELAYER, fontcolor=B_RELAYER)
g.edge("relayer", "stellar_wallet", label="SPV proof bundle", style="dashed", color=B_RELAYER, fontcolor=B_RELAYER)

# ── Frontend → Soroban ────────────────────────────────────────────────────────
g.edge("stellar_wallet", "writz_lend",
       label="deposit (SPV proof + key_sig)\nborrow · repay · supply · withdraw",
       color=B_STELLAR, fontcolor=B_STELLAR, penwidth="2")

# ── Soroban internal ──────────────────────────────────────────────────────────
g.edge("writz_lend", "bitcoin_spv", label="verify_transaction\nconsume_deposit", color=B_STELLAR, fontcolor=B_STELLAR)
g.edge("writz_lend", "oracle", label="lastprice", color=B_DEFAULT)
g.edge("writz_lend", "usdc", label="transfer", color=B_DEFAULT)

# ── Release flow ──────────────────────────────────────────────────────────────
g.edge("writz_lend", "repay_watcher", label="repay_full event", style="dashed", color=B_RELAYER, fontcolor=B_RELAYER)
g.edge("repay_watcher", "writz_lend", label="publish_release_psbt", color=B_RELAYER, fontcolor=B_RELAYER)
g.edge("writz_lend", "btc_lib", label="get_release_psbt", style="dashed", color=B_BITCOIN, fontcolor=B_BITCOIN)
g.edge("btc_lib", "btc_wallet", label="signPsbt (Xverse)", color=B_BITCOIN, fontcolor=B_BITCOIN)
g.edge("btc_lib", "btc_ledger", label="broadcast finalized tx", color=B_AMBER, fontcolor=B_AMBER, penwidth="2")

# Privacy edition shares only the SPV deposit registry with v1.
g.edge("commitment_tree", "bitcoin_spv", label="shared deposit registry", style="dotted", color=E_DEFAULT)
g.edge("commitment_tree", "zk_verifier", style="dotted", color=E_DEFAULT)

render(g, "01-system-architecture")
