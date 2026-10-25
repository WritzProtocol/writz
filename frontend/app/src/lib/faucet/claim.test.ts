import { describe, expect, it } from "bun:test";
import { claimSignetCoins, faucetClaimMessage, pollarAccessToken, SignetFaucetError } from "./claim";

const STELLAR = "GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT";
const SIGNET = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
const PUBKEY = "02" + "ab".repeat(32);
const NONCE = "0123456789abcdef0123456789abcdef";

type Call = { url: string; init?: RequestInit };

function relayer(answers: Record<string, { status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchMock = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = `${init?.method ?? "GET"} ${new URL(url).pathname}`;
    const a = answers[key];
    if (!a) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(a.body), { status: a.status });
  }) as unknown as typeof fetch;
  return { fetchMock, calls };
}

const input = (fetchMock: typeof fetch, signed: string[] = []) => ({
  relayerUrl: "https://relayer.test/",
  accessToken: "pollar-token",
  stellarAddress: STELLAR,
  signetAddress: SIGNET,
  signetPubkey: PUBKEY,
  signMessage: async (m: string) => {
    signed.push(m);
    return "SIG";
  },
  fetch: fetchMock,
});

describe("faucetClaimMessage", () => {
  it("binds the nonce, the Stellar address and the Signet address, byte for byte as the relayer builds it", () => {
    expect(faucetClaimMessage(NONCE, STELLAR, SIGNET)).toBe(
      `Writz Signet faucet\nnonce:${NONCE}\nstellar:${STELLAR}\nsignet:${SIGNET}`,
    );
  });
});

describe("pollarAccessToken", () => {
  it("reads the token of an authenticated session and nothing otherwise", () => {
    const authed = { getAuthState: () => ({ step: "authenticated", session: { token: { accessToken: "abc" } } }) };
    expect(pollarAccessToken(authed as never)).toBe("abc");
    expect(pollarAccessToken({ getAuthState: () => ({ step: "idle" }) } as never)).toBeNull();
  });
});

describe("claimSignetCoins", () => {
  it("fetches a nonce, signs the claim message and posts the claim", async () => {
    const { fetchMock, calls } = relayer({
      "GET /faucet/signet/nonce": { status: 200, body: { nonce: NONCE, expiresAt: "2026-10-25T12:05:00.000Z" } },
      "POST /faucet/signet": {
        status: 200,
        body: { txid: "f".repeat(64), explorerUrl: `https://mempool.space/signet/tx/${"f".repeat(64)}`, amountSats: 20000, feeSats: 300, address: SIGNET },
      },
    });
    const signed: string[] = [];
    const r = await claimSignetCoins(input(fetchMock, signed));

    expect(r).toEqual({ txid: "f".repeat(64), explorerUrl: `https://mempool.space/signet/tx/${"f".repeat(64)}`, amountSats: 20000 });
    expect(signed).toEqual([faucetClaimMessage(NONCE, STELLAR, SIGNET)]);
    expect(calls.map((c) => c.url)).toEqual(["https://relayer.test/faucet/signet/nonce", "https://relayer.test/faucet/signet"]);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      pollarAccessToken: "pollar-token",
      stellarAddress: STELLAR,
      signetAddress: SIGNET,
      signetPubkey: PUBKEY,
      nonce: NONCE,
      keySig: "SIG",
    });
  });

  it("surfaces the relayer's refusal with its code and the public faucets", async () => {
    const { fetchMock } = relayer({
      "GET /faucet/signet/nonce": { status: 200, body: { nonce: NONCE } },
      "POST /faucet/signet": {
        status: 409,
        body: { error: "account_already_claimed", message: "this account has already received its Signet coins" },
      },
    });
    const err = await claimSignetCoins(input(fetchMock)).catch((e) => e);
    expect(err).toBeInstanceOf(SignetFaucetError);
    expect(err).toMatchObject({ code: "account_already_claimed", status: 409, alreadyClaimed: true });
  });

  it("reports a switched-off faucet before signing anything", async () => {
    const { fetchMock } = relayer({
      "GET /faucet/signet/nonce": {
        status: 503,
        body: { error: "faucet_disabled", message: "not available", publicFaucets: ["https://signetfaucet.com"] },
      },
    });
    const signed: string[] = [];
    const err = await claimSignetCoins(input(fetchMock, signed)).catch((e) => e);
    expect(err).toMatchObject({ code: "faucet_disabled", status: 503, publicFaucets: ["https://signetfaucet.com"] });
    expect(signed).toEqual([]);
  });

  it("turns an unreachable relayer into network_error", async () => {
    const { fetchMock } = relayer({});
    await expect(claimSignetCoins(input(fetchMock))).rejects.toMatchObject({ code: "network_error", status: 0 });
  });
});
