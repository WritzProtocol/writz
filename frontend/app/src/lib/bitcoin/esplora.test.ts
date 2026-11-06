import { describe, expect, mock, test } from "bun:test";
import { createEsploraFetch } from "./esplora";

const A = "https://a/api";
const B = "https://b/api";

const ok = (body = "1") => new Response(body);

describe("createEsploraFetch", () => {
  test("a provider that refuses the connection is skipped for the next one, same path", async () => {
    const get = mock(async (url: string) => {
      if (url.startsWith(A)) throw new TypeError("Failed to fetch");
      return ok("tx");
    });
    const res = await createEsploraFetch({ providers: [A, B], fetch: get })(`${A}/tx/abc`);
    expect(await res.text()).toBe("tx");
    expect(get.mock.calls.map((c) => c[0])).toEqual([`${A}/tx/abc`, `${B}/tx/abc`]);
  });

  test("429 and 5xx move on; 404 is an answer", async () => {
    const status = { [A]: 429, [B]: 404 } as Record<string, number>;
    const get = mock(async (url: string) => new Response("", { status: status[url.slice(0, A.length)] }));
    const res = await createEsploraFetch({ providers: [A, B], fetch: get })(`${A}/tx/abc/status`);
    expect(res.status).toBe(404);
    expect(get).toHaveBeenCalledTimes(2);
  });

  test("a host that never answers times out and the next provider serves", async () => {
    const get = mock((url: string, init?: RequestInit) =>
      url.startsWith(A)
        ? new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))
        : Promise.resolve(ok("329723")),
    );
    const res = await createEsploraFetch({ providers: [A, B], fetch: get, timeoutMs: 20 })(`${A}/blocks/tip/hash`);
    expect(await res.text()).toBe("329723");
  });

  test("the provider that answered is tried first next time", async () => {
    const get = mock(async (url: string) => {
      if (url.startsWith(A)) throw new TypeError("blocked");
      return ok();
    });
    const esplora = createEsploraFetch({ providers: [A, B], fetch: get });
    await esplora(`${A}/tx/1`);
    await esplora(`${A}/tx/2`);
    expect(get.mock.calls.map((c) => c[0])).toEqual([`${A}/tx/1`, `${B}/tx/1`, `${B}/tx/2`]);
  });

  test("every loan on screen shares one tip read within the window", async () => {
    let t = 0;
    const get = mock(async () => ok("329723"));
    const esplora = createEsploraFetch({ providers: [A], fetch: get, now: () => t, tipTtlMs: 10_000 });
    const reads = await Promise.all([1, 2, 3].map(() => esplora(`${A}/blocks/tip/height`).then((r) => r.text())));
    expect(reads).toEqual(["329723", "329723", "329723"]);
    expect(get).toHaveBeenCalledTimes(1);
    t = 11_000;
    await esplora(`${A}/blocks/tip/height`);
    expect(get).toHaveBeenCalledTimes(2);
  });

  test("identical reads in flight share one request", async () => {
    const get = mock(async () => ok("{}"));
    const esplora = createEsploraFetch({ providers: [A], fetch: get });
    await Promise.all([esplora(`${A}/tx/abc`), esplora(`${A}/tx/abc`)]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  test("a broadcast is retried on the next provider when the first is unreachable", async () => {
    const get = mock(async (url: string) => {
      if (url.startsWith(A)) throw new TypeError("blocked");
      return ok("txid");
    });
    const res = await createEsploraFetch({ providers: [A, B], fetch: get })(`${A}/tx`, { method: "POST", body: "00" });
    expect(await res.text()).toBe("txid");
    expect(get.mock.calls[1]).toMatchObject([`${B}/tx`, { method: "POST", body: "00" }]);
  });

  test("other hosts pass straight through", async () => {
    const get = mock(async () => ok());
    await createEsploraFetch({ providers: [A, B], fetch: get })("https://relayer/health");
    expect(get.mock.calls[0][0]).toBe("https://relayer/health");
    expect(get).toHaveBeenCalledTimes(1);
  });
});
