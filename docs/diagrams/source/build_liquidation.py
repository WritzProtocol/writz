from wz import *
K, L, SG, BTC, S = 120, 370, 620, 870, 1120
A = [(K, "Keeper", "", "default"), (L, "writz-lend", "", "focal"), (SG, "Protocol signers", "", "default"),
     (BTC, "Bitcoin", "", "default"), (S, "bitcoin-spv", "", "default")]
M = [(176, K, L, "REPAY DEBT", "call"),
     (204, L, L, "TRIGGER, STEP", "self"),
     (272, L, SG, "STEP SELECTED", "async"),
     (320, SG, L, "CO-SIGNATURE", "call"),
     (368, K, L, "GET STEP TX", "call"),
     (408, L, K, "SIGNED STEP", "return"),
     (456, K, BTC, "BROADCAST", "call"),
     (496, BTC, K, "KEEPER SHARE", "return"),
     (544, K, L, "SPV PROOF", "call"),
     (584, L, S, "VERIFY TX", "call"),
     (624, S, L, "CONFIRMED", "return"),
     (652, L, L, "SETTLE", "selfaccent")]
def body(skin):
    c = SK[skin]
    s = seq(c, A, M, act_bars=[(L, 176, 232), (L, 544, 680)], bottom=720)
    note = f'<text x="40" y="764" fill="{c["muted"]}" font-size="13" font-style="italic" font-family="{SANS}">The keeper\'s USDC sits in escrow until the proof arrives; the step pays the keeper and returns the remainder to the borrower.</text>'
    return s + "\n" + note + "\n" + legend(c, 824, [("line", "Call"), ("dashed", "Return or event"), ("accentline", "Lenders repaid")], 1280)
for sk in ("light", "dark"):
    page("liquidation", sk, "Liquidation, settled on Bitcoin and proven on Stellar",
         "A keeper repays an unhealthy or matured loan into escrow, writz-lend selects the pre-signed step and the protocol signers co-sign it, the keeper broadcasts it on Bitcoin and proves its confirmation through bitcoin-spv, and writz-lend settles the escrow.",
         1280, 864, body(sk), eyebrow="Sequence")
