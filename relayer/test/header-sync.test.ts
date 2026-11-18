import { describe, expect, test } from '@jest/globals';
import {
  assertWithinFeeCeiling,
  driveReorg,
  FeeCeilingExceededError,
  ForkSearchExhaustedError,
  forkSafeStartHeight,
  isMissingContractFunction,
  hasNewHeaders,
  type HeaderSyncStatus,
  headerSyncStatus,
  internalHashToDisplayHex,
  planHeaderBatches,
  recordRelayerBalance,
  REORG_RESUBMIT_DEPTH,
  stroopsToXlm,
  syncHeaders,
  syncStartHeight,
  withBackoff,
} from '../src/bitcoin/header-sync';
import { xlmToStroops } from '../src/config';

describe('planHeaderBatches', () => {
  test('splits a range into contiguous batches of at most maxPerSubmit', () => {
    expect(planHeaderBatches(100, 140, 16)).toEqual([
      { fromHeight: 100, toHeight: 115 },
      { fromHeight: 116, toHeight: 131 },
      { fromHeight: 132, toHeight: 140 },
    ]);
  });

  test('a single height is one batch', () => {
    expect(planHeaderBatches(5, 5, 16)).toEqual([{ fromHeight: 5, toHeight: 5 }]);
  });

  test('an empty range (from > to) plans nothing', () => {
    expect(planHeaderBatches(10, 9, 16)).toEqual([]);
  });

  test('rejects a non-positive batch size', () => {
    expect(() => planHeaderBatches(0, 10, 0)).toThrow(RangeError);
  });
});

describe('syncHeaders', () => {
  test('submits every height exactly once, in order, batch by batch', async () => {
    const submitted: string[][] = [];
    const result = await syncHeaders(0, 4, 2, {
      getHeaderHex: async (h) => `hdr${h}`,
      submitHeaders: async (headers) => {
        submitted.push(headers);
      },
    });
    expect(submitted).toEqual([
      ['hdr0', 'hdr1'],
      ['hdr2', 'hdr3'],
      ['hdr4'],
    ]);
    expect(result.submittedThrough).toBe(4);
  });

  test('stops at the first failed batch and reports where it got to', async () => {
    let calls = 0;
    const result = await syncHeaders(0, 9, 3, {
      getHeaderHex: async (h) => `hdr${h}`,
      submitHeaders: async () => {
        calls++;
        if (calls === 2) throw new Error('rpc down');
      },
    }).catch((e) => e);
    expect(result).toBeInstanceOf(Error);
    expect(calls).toBe(2);
  });

  test('nothing to submit reports null', async () => {
    const result = await syncHeaders(10, 9, 3, {
      getHeaderHex: async () => '',
      submitHeaders: async () => {
        throw new Error('must not be called');
      },
    });
    expect(result.submittedThrough).toBeNull();
  });
});

describe('syncStartHeight', () => {
  test('resumes just below the contract tip instead of the configured height', () => {
    expect(syncStartHeight(280_000, 281_500)).toBe(281_500 - REORG_RESUBMIT_DEPTH);
  });

  test('never starts before the configured height', () => {
    expect(syncStartHeight(280_000, 280_002)).toBe(280_000);
  });

  test('starts at the configured height when the contract tip is unknown', () => {
    expect(syncStartHeight(280_000, undefined)).toBe(280_000);
  });
});

describe('withBackoff', () => {
  const noSleep = { sleep: async () => {} };

  test('retries a retryable failure and returns the eventual result', async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await withBackoff(
      async () => { if (++calls < 3) throw new Error('429'); return 'ok'; },
      () => true,
      { baseDelayMs: 100, sleep: async (ms) => { delays.push(ms); } },
    );
    expect(result).toBe('ok');
    expect(delays).toEqual([100, 200]);
  });

  test('does not retry an error it is told is final', async () => {
    let calls = 0;
    await expect(withBackoff(async () => { calls++; throw new Error('404'); }, () => false, noSleep)).rejects.toThrow('404');
    expect(calls).toBe(1);
  });

  test('gives up after the configured retries', async () => {
    let calls = 0;
    await expect(withBackoff(async () => { calls++; throw new Error('429'); }, () => true, { retries: 2, ...noSleep })).rejects.toThrow('429');
    expect(calls).toBe(3);
  });
});

describe('hasNewHeaders', () => {
  const A = 'aa'.repeat(32);
  const B = 'bb'.repeat(32);
  const stored = (hashes: string[]) => async (h: string) => hashes.includes(h.toLowerCase());
  const neverAsked = async () => {
    throw new Error('isStored must not be needed here');
  };

  test('submits when the contract has no tip yet', async () => {
    expect(await hasNewHeaders({ height: 100, hash: A }, undefined, neverAsked)).toBe(true);
  });

  test('submits when the Bitcoin source is ahead', async () => {
    expect(await hasNewHeaders({ height: 101, hash: B }, { height: 100, hash: A }, neverAsked)).toBe(true);
  });

  test('skips when the source tip is the contract tip (no new block)', async () => {
    expect(await hasNewHeaders({ height: 100, hash: A }, { height: 100, hash: A }, neverAsked)).toBe(false);
  });

  test('compares hashes case-insensitively', async () => {
    expect(await hasNewHeaders({ height: 100, hash: A.toUpperCase() }, { height: 100, hash: A }, neverAsked)).toBe(false);
  });

  test('submits on a same-height reorg so the competing branch is offered', async () => {
    expect(await hasNewHeaders({ height: 100, hash: B }, { height: 100, hash: A }, stored([]))).toBe(true);
  });

  test('submits a lower tip the contract does not store (a shorter chain with more work)', async () => {
    expect(await hasNewHeaders({ height: 98, hash: B }, { height: 100, hash: A }, stored([]))).toBe(true);
  });

  test('skips when the source lags behind on a block the contract already stores', async () => {
    expect(await hasNewHeaders({ height: 99, hash: B }, { height: 100, hash: A }, stored([B]))).toBe(false);
  });

  test('a new block after a deeper reorg still resubmits from below the contract tip', async () => {
    // The skip only gates whether a pass runs; where it starts is unchanged.
    expect(await hasNewHeaders({ height: 101, hash: B }, { height: 100, hash: A }, neverAsked)).toBe(true);
    expect(syncStartHeight(0, 100)).toBe(100 - REORG_RESUBMIT_DEPTH);
  });
});

describe('internalHashToDisplayHex', () => {
  test('reverses the internal byte order into Esplora display hex', () => {
    const internal = new Uint8Array(32);
    internal[0] = 0x01;
    internal[31] = 0xff;
    const hex = internalHashToDisplayHex(internal);
    expect(hex.startsWith('ff')).toBe(true);
    expect(hex.endsWith('01')).toBe(true);
    expect(hex).toHaveLength(64);
  });
});

describe('fee ceiling', () => {
  test('converts XLM to stroops and back', () => {
    expect(xlmToStroops(5)).toBe(50_000_000n);
    expect(xlmToStroops(0.0067590)).toBe(67_590n);
    expect(stroopsToXlm(1_814_500_000n)).toBe('181.4500000');
    expect(stroopsToXlm(67_590n)).toBe('0.0067590');
  });

  test('accepts a fee at or under the ceiling', () => {
    expect(() => assertWithinFeeCeiling(50_000_000n, 50_000_000n)).not.toThrow();
    expect(() => assertWithinFeeCeiling(1_067_590n, 50_000_000n)).not.toThrow();
  });

  test('rejects a fee above the ceiling, naming both amounts', () => {
    let caught: unknown;
    try {
      assertWithinFeeCeiling(1_814_500_000n, 50_000_000n);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FeeCeilingExceededError);
    const err = caught as FeeCeilingExceededError;
    expect(err.feeStroops).toBe(1_814_500_000n);
    expect(err.maxFeeStroops).toBe(50_000_000n);
    expect(err.message).toContain('181.4500000 XLM');
    expect(err.message).toContain('5.0000000 XLM');
  });

  test('a rejected batch stops the sync without marking it submitted', async () => {
    const result = syncHeaders(10, 12, 16, {
      getHeaderHex: async (h) => `hdr${h}`,
      submitHeaders: async () => assertWithinFeeCeiling(2n, 1n),
    });
    await expect(result).rejects.toBeInstanceOf(FeeCeilingExceededError);
  });
});

describe('recordRelayerBalance', () => {
  const fresh = (): HeaderSyncStatus => ({ ...headerSyncStatus });

  test('flags a balance under the threshold', () => {
    const status = fresh();
    expect(recordRelayerBalance(status, xlmToStroops(99.5), xlmToStroops(100))).toBe(true);
    expect(status.balanceLow).toBe(true);
    expect(status.relayerBalanceXlm).toBe('99.5000000');
    expect(status.minBalanceXlm).toBe('100.0000000');
  });

  test('clears the flag once the account is topped up', () => {
    const status = fresh();
    recordRelayerBalance(status, 1n, xlmToStroops(100));
    expect(recordRelayerBalance(status, xlmToStroops(100), xlmToStroops(100))).toBe(false);
    expect(status.balanceLow).toBe(false);
  });
});

describe('forkSafeStartHeight', () => {
  test('keeps the start when the block below it is stored (normal case, one lookup)', async () => {
    const asked: number[] = [];
    const from = await forkSafeStartHeight(94, 0, async (h) => {
      asked.push(h);
      return true;
    });
    expect(from).toBe(94);
    expect(asked).toEqual([93]);
  });

  test('steps below a reorg deeper than the resubmit depth to the last shared block', async () => {
    // The contract is on another branch above 70; Bitcoin's 70 is stored.
    const from = await forkSafeStartHeight(94, 0, async (h) => h <= 70);
    expect(from).toBe(71);
  });

  test('never goes below the configured floor', async () => {
    expect(await forkSafeStartHeight(94, 90, async () => false)).toBe(90);
  });

  test('throws once maxDepth heights are searched without a stored block', async () => {
    await expect(forkSafeStartHeight(94, 0, async () => false, 10)).rejects.toBeInstanceOf(ForkSearchExhaustedError);
    expect(await forkSafeStartHeight(94, 0, async (h) => h === 83, 10)).toBe(84);
  });

  test('finds the common ancestor when Bitcoin\'s tip is below the contract\'s', async () => {
    // Contract tip 100 on branch A; Bitcoin's heavier branch ends at 97 and
    // forks after 90. The sync starts at most at Bitcoin's tip.
    const start = Math.min(syncStartHeight(0, 100), 97);
    expect(await forkSafeStartHeight(start, 0, async (h) => h <= 90)).toBe(91);
  });
});

describe('driveReorg', () => {
  test('sends nothing when no chain switch is pending', async () => {
    let sent = 0;
    const calls = await driveReorg({
      isPending: async () => false,
      continueReorg: async () => {
        sent++;
        return false;
      },
    });
    expect(calls).toBe(0);
    expect(sent).toBe(0);
  });

  test('continues a multi-call switch until the contract reports it complete', async () => {
    let remaining = 3; // the switch needs three more continue_reorg calls
    const calls = await driveReorg({
      isPending: async () => remaining > 0,
      continueReorg: async () => --remaining > 0,
    });
    expect(calls).toBe(3);
    expect(remaining).toBe(0);
  });

  // Simulation error text from a light client deployed before get_pending_reorg existed.
  const missingFunction = new Error(
    'get_pending_reorg simulation failed: HostError: Error(WasmVm, MissingValue)\n\nEvent log (newest first):\n' +
      '   0: [Diagnostic Event] topics:[error, Error(WasmVm, MissingValue)], data:["trying to invoke non-existent contract function", get_pending_reorg]',
  );

  test('treats a contract without get_pending_reorg as having nothing pending', async () => {
    let unsupported = 0;
    let sent = 0;
    const calls = await driveReorg({
      isPending: async () => {
        throw missingFunction;
      },
      continueReorg: async () => {
        sent++;
        return false;
      },
      onUnsupported: () => unsupported++,
    });
    expect(calls).toBe(0);
    expect(sent).toBe(0);
    expect(unsupported).toBe(1);
  });

  test('any other read failure still propagates', async () => {
    const other = [
      new Error('get_pending_reorg simulation failed: HostError: Error(Storage, MissingValue)'),
      new Error('get_pending_reorg simulation failed: HostError: Error(WasmVm, MissingValue) trying to invoke non-existent contract function, continue_reorg'),
      new Error('connect ECONNREFUSED'),
    ];
    for (const e of other) {
      await expect(
        driveReorg({
          isPending: async () => {
            throw e;
          },
          continueReorg: async () => false,
        }),
      ).rejects.toBe(e);
    }
    expect(isMissingContractFunction(missingFunction, 'get_pending_reorg')).toBe(true);
    expect(isMissingContractFunction(missingFunction, 'get_pending')).toBe(false);
  });

  test('stops at maxCalls and leaves the rest to the next pass', async () => {
    const calls = await driveReorg({ isPending: async () => true, continueReorg: async () => true }, 4);
    expect(calls).toBe(4);
  });
});

describe('syncHeaders with a pending chain switch', () => {
  test('drains a pending switch before each batch is sent', async () => {
    const events: string[] = [];
    let pending = false;
    let continueCallsLeft = 0;
    const budget = { remaining: 10 };
    await syncHeaders(1, 40, 16, {
      getHeaderHex: async (h) => h.toString(16),
      submitHeaders: async (headers) => {
        events.push(`submit ${headers.length} (pending ${pending})`);
        // The first batch makes a switch that needs two continue calls.
        if (events.length === 1) {
          pending = true;
          continueCallsLeft = 2;
        }
      },
      beforeBatch: async () => {
        budget.remaining -= await driveReorg(
          {
            isPending: async () => pending,
            continueReorg: async () => {
              events.push('continue');
              pending = --continueCallsLeft > 0;
              return pending;
            },
          },
          budget.remaining,
        );
      },
    });
    expect(events).toEqual([
      'submit 16 (pending false)',
      'continue',
      'continue',
      'submit 16 (pending false)',
      'submit 8 (pending false)',
    ]);
    expect(budget.remaining).toBe(8);
  });

  test('stops continuing once the pass budget is spent', async () => {
    let sent = 0;
    const calls = await driveReorg(
      {
        isPending: async () => true,
        continueReorg: async () => {
          sent++;
          return true;
        },
      },
      0,
    );
    expect(calls).toBe(0);
    expect(sent).toBe(0);
  });
});
