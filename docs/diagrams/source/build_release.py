from wz import *
B, BTC, L, SG = 110, 330, 550, 760
A = [(B, "Borrower", "", "user"), (BTC, "Bitcoin", "", "default"), (L, "writz-lend", "", "focal"), (SG, "Protocol signers", "", "default")]
M = [(176, B, L, "REPAY IN FULL", "call"),
     (216, L, B, "DEBT CLEARED", "return"),
     (264, L, SG, "REPAID EVENT", "async"),
     (292, SG, SG, "CHECK STATE", "self"),
     (360, SG, L, "PUBLISH CO-SIG", "call"),
     (408, B, L, "GET RELEASE", "call"),
     (448, L, B, "RELEASE TX", "return"),
     (496, B, BTC, "SIGN, BROADCAST", "accent"),
     (600, B, BTC, "TIMELOCK SPEND", "call")]
def body(skin):
    c = SK[skin]
    s = seq(c, A, M, act_bars=[(L, 176, 216), (L, 408, 448)], bottom=640,
            frames=[(82, 536, 292, 88, "OPT", "[signers unavailable, after height H]")])
    note = f'<text x="24" y="684" fill="{c["muted"]}" font-size="{F_NOTE}" font-style="italic" font-family="{SANS}">Each protocol signer checks Stellar on its own and co-signs only a repaid position.</text>'
    return s + "\n" + note + "\n" + legend(c, 744, [("line", "Call"), ("dashed", "Return or event"), ("accentline", "Bitcoin back to the borrower")], 960)
for sk in ("light", "dark"):
    page("repay-and-release", sk, "Repaying a loan and releasing the Bitcoin",
         "After a full repayment writz-lend emits an event, the protocol signers check the position on Stellar and publish their co-signature, and the borrower signs and broadcasts the release; if the signers are unavailable, the borrower spends alone after the timelock.",
         960, 784, body(sk), eyebrow="Sequence")
