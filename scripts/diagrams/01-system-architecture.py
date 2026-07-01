"""
Writz Protocol — 01 System Architecture
Full three-layer view: Bitcoin network, Stellar/Soroban contracts, Browser frontend.
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
        "Writz Protocol — System Architecture",
        "Trustless ZK-private Bitcoin lending on Stellar · live on testnet",
    ),
))
g.attr("node", **base_node_attr())
g.attr("edge", **base_edge_attr())

# ── Bitcoin Network ───────────────────────────────────────────────────────────
with g.subgraph(name="cluster_bitcoin") as b:
    b.attr(**cluster_attr("Bitcoin Network", B_BITCOIN, "Collateral locked in P2WSH · never custodied by Writz"))
    b.node("btc_wallet", hl("User Bitcoin Wallet", "Xverse · sats-connect", "Funds P2WSH address · signs release PSBT"),
           fillcolor=F_BITCOIN, color=B_BITCOIN)
    b.node("p2wsh", hl("P2WSH Locking Script", "Path A: protocol + user co-sign", "Path B: CLTV timelock (emergency recovery)"),
           fillcolor=F_BITCOIN, color=B_BITCOIN, shape="box")
    b.node("btc_ledger", hl("Bitcoin Ledger", "Testnet / Mainnet", "Source of truth for collateral UTXOs"),
           fillcolor=F_BITCOIN, color=B_BITCOIN, shape="cylinder", penwidth="2")

# ── Relayer ───────────────────────────────────────────────────────────────────
with g.subgraph(name="cluster_relayer") as r:
    r.attr(**cluster_attr("SPV Relayer", B_RELAYER, "Node/Bun · stateless · GET /spv-proof/:txid"))
    r.node("relayer", hl("SPV Relayer", "Watches Bitcoin blocks", "Builds merkle proof + block headers for Soroban"),
           fillcolor=F_RELAYER, color=B_RELAYER)

# ── Soroban Contracts ─────────────────────────────────────────────────────────
with g.subgraph(name="cluster_soroban") as s:
    s.attr(**cluster_attr("Soroban Contracts  ·  Stellar Testnet", B_STELLAR,
                          "Four live contracts · 268 tests passing"))
    s.node("bitcoin_spv", hl("bitcoin-spv", "Verifies Bitcoin SPV proofs", "Block headers · merkle paths · confirmations"),
           fillcolor=F_STELLAR, color=B_STELLAR)
    s.node("zk_verifier", hl("zk-verifier", "Groth16 / BN254 on-chain", "Protocol X-Ray host functions · verifies all circuits"),
           fillcolor=F_ZK, color=B_ZK)
    s.node("commitment_tree", hl("commitment-tree", "Poseidon Merkle tree · depth 20", "deposit · borrow · repay · insert_commitment"),
           fillcolor=F_STELLAR, color=B_STELLAR)
    s.node("private_lend", hl("private-lend", "USDC lending pool", "supply · withdraw · collateral ratio · liquidation"),
           fillcolor=F_STELLAR, color=B_STELLAR)

# ── Browser / Frontend ────────────────────────────────────────────────────────
with g.subgraph(name="cluster_frontend") as f:
    f.attr(**cluster_attr("Browser  ·  Trust Boundary", B_FRONTEND,
                          "ZK proofs generated in-browser · secrets never leave device"))
    f.node("stellar_wallet", hl("Stellar Wallet", "Freighter · stellar-wallets-kit", "Signs Soroban transactions"),
           fillcolor=F_FRONTEND, color=B_FRONTEND)
    f.node("zk_prover", hl("In-Browser ZK Prover", "snarkjs · Groth16", "deposit · borrow_repay · liquidation circuits"),
           fillcolor=F_ZK, color=B_ZK)
    f.node("position_store", hl("Position Store", "localStorage only · no backend", "secret · nonce · commitment · nullifier · btcPubkey"),
           fillcolor=F_FRONTEND, color=B_FRONTEND)
    f.node("btc_lib", hl("Bitcoin (browser)", "bitcoinjs-lib · sats-connect", "P2WSH derivation · PSBT build + sign"),
           fillcolor=F_BITCOIN, color=B_BITCOIN)
    f.node("admin_api", hl("Next.js API Routes", "/api/insert-commitment (ADMIN_SECRET)", "/api/cosign (PROTOCOL_SIGNING_KEY)"),
           fillcolor=F_RELAYER, color=B_RELAYER)

# ── Bitcoin flow ──────────────────────────────────────────────────────────────
g.edge("btc_wallet", "p2wsh",
       label="fund deposit", color=B_BITCOIN, fontcolor=B_BITCOIN, penwidth="2")
g.edge("p2wsh", "btc_ledger", penwidth="2", color=B_BITCOIN)
g.edge("btc_ledger", "relayer",
       label="block data", style="dashed", color=B_RELAYER, fontcolor=B_RELAYER)

# ── Relayer → Soroban ─────────────────────────────────────────────────────────
g.edge("relayer", "bitcoin_spv",
       label="SPV bundle\n(headers + merkle proof)", color=B_RELAYER, fontcolor=B_RELAYER)

# ── Frontend → Soroban ────────────────────────────────────────────────────────
g.edge("zk_prover", "commitment_tree",
       label="ZK proof + public signals", color=B_ZK, fontcolor=B_ZK, penwidth="2")
g.edge("stellar_wallet", "commitment_tree",
       label="signed deposit/borrow/repay tx", color=B_STELLAR, fontcolor=B_STELLAR)
g.edge("stellar_wallet", "private_lend",
       label="supply / withdraw", style="dashed", color=B_STELLAR)
g.edge("admin_api", "commitment_tree",
       label="insert_commitment (Phase 1)", style="dashed", color=B_RELAYER, fontcolor=B_RELAYER)

# ── Soroban internal ──────────────────────────────────────────────────────────
g.edge("bitcoin_spv", "commitment_tree",
       label="SPV verified", color=B_STELLAR)
g.edge("commitment_tree", "zk_verifier",
       label="verify_deposit / verify_borrow_repay", color=B_ZK, fontcolor=B_ZK)
g.edge("commitment_tree", "private_lend",
       label="USDC transfer", color=B_STELLAR)

# ── Release flow ──────────────────────────────────────────────────────────────
g.edge("btc_lib", "admin_api",
       label="PSBT → /api/cosign", style="dashed", color=B_BITCOIN, fontcolor=B_BITCOIN)
g.edge("btc_lib", "btc_wallet",
       label="signPsbt (Xverse)", color=B_BITCOIN, fontcolor=B_BITCOIN)
g.edge("btc_lib", "btc_ledger",
       label="broadcast finalized tx", color=B_AMBER, fontcolor=B_AMBER, penwidth="2")

# ── Position store ────────────────────────────────────────────────────────────
g.edge("zk_prover", "position_store",
       label="save commitment / nullifier", style="dashed", color=E_DEFAULT)
g.edge("position_store", "zk_prover",
       label="secret · nonce · collateral", style="dashed", color=E_DEFAULT)

render(g, "01-system-architecture")
