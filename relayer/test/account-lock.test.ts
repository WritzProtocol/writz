import { withAccountLock } from "../src/account-lock";

/** A task that only finishes when the test says so, recording when it ran. */
function deferredTask(log: string[], name: string) {
  let finish!: () => void;
  let fail!: (e: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const task = async () => {
    log.push(`${name}:start`);
    await done;
    log.push(`${name}:end`);
    return name;
  };
  return { task, finish: () => finish(), fail: (e: Error) => fail(e) };
}

const flush = () => new Promise((r) => setImmediate(r));

describe("withAccountLock", () => {
  test("a second transaction from the same account is only built once the first has settled", async () => {
    const log: string[] = [];
    const publish = deferredTask(log, "publish");
    const headers = deferredTask(log, "headers");

    const first = withAccountLock("GRELAYER", publish.task);
    const second = withAccountLock("GRELAYER", headers.task);
    await flush();
    expect(log).toEqual(["publish:start"]);

    publish.finish();
    await expect(first).resolves.toBe("publish");
    await flush();
    expect(log).toEqual(["publish:start", "publish:end", "headers:start"]);

    headers.finish();
    await expect(second).resolves.toBe("headers");
  });

  test("a failed transaction releases the account for the next one and keeps its own error", async () => {
    const log: string[] = [];
    const publish = deferredTask(log, "publish");
    const headers = deferredTask(log, "headers");

    const first = withAccountLock("GRELAYER", publish.task);
    const second = withAccountLock("GRELAYER", headers.task);
    publish.fail(new Error("Waited 60 seconds for transaction to complete"));
    await expect(first).rejects.toThrow("Waited 60 seconds");

    await flush();
    expect(log).toContain("headers:start");
    headers.finish();
    await expect(second).resolves.toBe("headers");
  });

  test("different accounts do not wait for each other", async () => {
    const log: string[] = [];
    const relayer = deferredTask(log, "relayer");
    const keeper = deferredTask(log, "keeper");

    const a = withAccountLock("GRELAYER", relayer.task);
    const b = withAccountLock("GKEEPER", keeper.task);
    await flush();
    expect(log).toEqual(["relayer:start", "keeper:start"]);

    keeper.finish();
    relayer.finish();
    await expect(Promise.all([a, b])).resolves.toEqual(["relayer", "keeper"]);
  });

  test("runs queued tasks in submission order", async () => {
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        withAccountLock("GRELAYER", async () => {
          await new Promise((r) => setTimeout(r, 5 - n));
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3, 4]);
  });
});
