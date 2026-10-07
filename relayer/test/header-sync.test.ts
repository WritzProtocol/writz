import { describe, expect, test } from '@jest/globals';
import { planHeaderBatches, REORG_RESUBMIT_DEPTH, syncHeaders, syncStartHeight } from '../src/bitcoin/header-sync';

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
