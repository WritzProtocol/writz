// `withPromptRetry` only. Polling and the release sweep need real SQLite
// transactions, so they are in repay-watcher.bun.test.ts.
//
// NOTE: this suite deliberately never imports `@stellar/stellar-sdk` (nor
// anything that transitively does at module scope, like `./handler.js`).
// That package's CJS build `require()`s an ESM-only `@noble/hashes` file,
// which crashes under ts-jest's strict CommonJS loader (works fine under
// Bun's own runtime, which the relayer actually ships on). `poller.ts`
// defers all such imports into function bodies for exactly this reason -
// see that file's top-of-file comment.

describe("withPromptRetry", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  const txid = Buffer.from("afd69080ef55cf4544f14c5b2ccab50cecc0dfd767a9865a96b716854e089d45", "hex");

  test("retries a failed publish within seconds and stops at the first success", async () => {
    const { withPromptRetry } = require("../src/repay-watcher/poller.js");
    const handle = jest
      .fn()
      .mockRejectedValueOnce(new Error("Waited 60 seconds for transaction to complete, but it did not."))
      .mockResolvedValueOnce(undefined);
    const sleep = jest.fn().mockResolvedValue(undefined);

    await withPromptRetry(handle, { sleep })(txid);

    expect(handle).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenNthCalledWith(2, txid);
    expect(sleep.mock.calls).toEqual([[2_000]]);
  });

  test("gives up after three attempts, 2 s and 4 s apart, and rethrows the last error", async () => {
    const { withPromptRetry } = require("../src/repay-watcher/poller.js");
    const handle = jest
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockRejectedValueOnce(new Error("third"));
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(withPromptRetry(handle, { sleep })(txid)).rejects.toThrow("third");
    expect(handle).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[2_000], [4_000]]);
  });
});
