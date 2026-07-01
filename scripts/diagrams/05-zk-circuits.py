"""
Writz Protocol — 05 ZK Circuits
Inputs and public outputs for all three Groth16 circuits.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from _style import *
import graphviz

g = graphviz.Digraph("zk-circuits")
g.attr(**base_graph_attr(
    rankdir="LR",
    splines="spline",
    size="18,10",
    label=hl(
        "Writz Protocol — ZK Circuits (Groth16 / BN254)",
        "All proofs generated in-browser via snarkjs · verified on Soroban via Protocol X-Ray host functions",
    ),
))
g.attr("node", **base_node_attr())
g.attr("edge", **base_edge_attr())

# ── Deposit Circuit ────────────────────────────────────────────────────────────
with g.subgraph(name="cluster_deposit") as d:
    d.attr(**cluster_attr("Deposit Circuit", B_BITCOIN, "circuits/deposit.circom"))
    d.node("dep_priv", hl("Private Inputs", "collateral_satoshis", "secret · nonce"),
           fillcolor=F_BITCOIN, color=B_BITCOIN)
    d.node("dep_pub_in", hl("Public Inputs", "btc_txid_lo · btc_txid_hi", "min_deposit_satoshis"),
           fillcolor=F_BITCOIN, color=B_BITCOIN)
    d.node("dep_circ", hl("deposit.circom", "Poseidon hash · range checks", "txid binding to commitment"),
           fillcolor=F_ZK, color=B_ZK, shape="hexagon")
    d.node("dep_out", hl("Public Outputs", "[0] commitment", "[1] nullifier · [2] txid_lo · [3] txid_hi · [4] min_deposit"),
           fillcolor=F_SUCCESS, color=B_SUCCESS)
    d.edge("dep_priv", "dep_circ", color=B_BITCOIN)
    d.edge("dep_pub_in", "dep_circ", color=B_BITCOIN)
    d.edge("dep_circ", "dep_out", color=B_ZK, penwidth="2")

# ── Borrow/Repay Circuit ──────────────────────────────────────────────────────
with g.subgraph(name="cluster_br") as b:
    b.attr(**cluster_attr("Borrow / Repay Circuit", B_STELLAR, "circuits/borrow_repay.circom"))
    b.node("br_priv", hl("Private Inputs", "collateral · old_debt · secret · nonce · new_nonce", "path_elements · path_indices · old_root"),
           fillcolor=F_STELLAR, color=B_STELLAR)
    b.node("br_pub_in", hl("Public Inputs", "delta_stroops · is_borrow (0 or 1)", "btc_price_stroops_per_btc · min_ratio_bp"),
           fillcolor=F_STELLAR, color=B_STELLAR)
    b.node("br_circ", hl("borrow_repay.circom", "Merkle inclusion proof", "Ratio enforcement · Poseidon commitment update"),
           fillcolor=F_ZK, color=B_ZK, shape="hexagon")
    b.node("br_out", hl("Public Outputs", "[0] old_root · [1] old_nullifier", "[2] new_commitment · [3] new_root · [4] delta · [5] is_borrow"),
           fillcolor=F_SUCCESS, color=B_SUCCESS)
    b.edge("br_priv", "br_circ", color=B_STELLAR)
    b.edge("br_pub_in", "br_circ", color=B_STELLAR)
    b.edge("br_circ", "br_out", color=B_ZK, penwidth="2")

# ── Liquidation Circuit ───────────────────────────────────────────────────────
with g.subgraph(name="cluster_liq") as l:
    l.attr(**cluster_attr("Liquidation Circuit", B_DANGER, "circuits/liquidation.circom"))
    l.node("liq_priv", hl("Private Inputs", "collateral · debt · secret · nonce", "path_elements · path_indices"),
           fillcolor=F_DANGER, color=B_DANGER)
    l.node("liq_pub_in", hl("Public Inputs", "merkle_root · btc_price_stroops_per_btc", "liquidation_threshold_bp"),
           fillcolor=F_DANGER, color=B_DANGER)
    l.node("liq_circ", hl("liquidation.circom", "Proves ratio < threshold", "Reveals debt amount for keeper"),
           fillcolor=F_ZK, color=B_ZK, shape="hexagon")
    l.node("liq_out", hl("Public Outputs", "[0] nullifier", "[1] usdc_debt (revealed!) · [2] merkle_root · [3] price · [4] threshold"),
           fillcolor=F_DANGER, color=B_DANGER)
    l.edge("liq_priv", "liq_circ", color=B_DANGER)
    l.edge("liq_pub_in", "liq_circ", color=B_DANGER)
    l.edge("liq_circ", "liq_out", color=B_ZK, penwidth="2")

# ── Verifier ──────────────────────────────────────────────────────────────────
g.node("verifier", hl("zk-verifier contract", "Groth16 verify on Soroban", "Protocol X-Ray host functions · BN254 pairing"),
       fillcolor=F_ZK, color=B_ZK)

g.edge("dep_out", "verifier", label="verify_deposit", color=B_ZK, fontcolor=B_ZK)
g.edge("br_out", "verifier", label="verify_borrow_repay", color=B_ZK, fontcolor=B_ZK)
g.edge("liq_out", "verifier", label="verify_liquidation", color=B_ZK, fontcolor=B_ZK)

render(g, "05-zk-circuits")
