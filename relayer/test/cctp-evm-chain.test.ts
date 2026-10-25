/**
 * The viem-backed `RelayChain`: the bounded, chunked search for a mint by
 * nonce, the chain-id check before the first write, and how send failures are
 * classified. viem's clients are mocked; its error classes are the real ones.
 */
import { BaseError, InsufficientFundsError } from 'viem';

const publicClient = {
  getChainId: jest.fn(),
  getBlockNumber: jest.fn(),
  getContractEvents: jest.fn(),
  getBalance: jest.fn(),
  readContract: jest.fn(),
  simulateContract: jest.fn(),
  waitForTransactionReceipt: jest.fn(),
};
const walletClient = { writeContract: jest.fn() };

jest.mock('viem', () => {
  const actual = jest.requireActual('viem');
  return { ...actual, createPublicClient: () => publicClient, createWalletClient: () => walletClient };
});

import { createEvmRelayChain } from '../src/cctp/evm-chain.js';
import { SendError } from '../src/cctp/chain.js';

const KEY = `0x${'11'.repeat(32)}` as const;
const NONCE = `0x${'36'.repeat(32)}`;

function chain(mintLookbackBlocks = 1_000) {
  return createEvmRelayChain({ privateKey: KEY, rpcUrl: 'https://rpc.test', mintLookbackBlocks });
}

beforeEach(() => {
  jest.resetAllMocks();
  publicClient.getChainId.mockResolvedValue(84532);
  publicClient.getBalance.mockResolvedValue(10n ** 16n);
});

describe('findMint', () => {
  test('searches back from the head in 200-block windows, down to the lookback floor', async () => {
    publicClient.getBlockNumber.mockResolvedValue(10_000n);
    publicClient.getContractEvents.mockResolvedValue([]);
    expect(await chain(500).findMint(NONCE)).toBeUndefined();
    const ranges = publicClient.getContractEvents.mock.calls.map(([a]) => [a.fromBlock, a.toBlock]);
    expect(ranges).toEqual([[9_801n, 10_000n], [9_601n, 9_800n], [9_500n, 9_600n]]);
    expect(publicClient.getContractEvents.mock.calls[0][0]).toMatchObject({ eventName: 'MessageReceived', args: { nonce: NONCE } });
  });

  test('returns the first MessageReceived log for the nonce, with its caller', async () => {
    publicClient.getBlockNumber.mockResolvedValue(10_000n);
    publicClient.getContractEvents
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ transactionHash: '0xabc', args: { caller: '0xCa11' } }]);
    expect(await chain().findMint(NONCE)).toEqual({ txHash: '0xabc', caller: '0xCa11' });
    expect(publicClient.getContractEvents).toHaveBeenCalledTimes(2);
  });

  test('stops at block 0 on a young chain', async () => {
    publicClient.getBlockNumber.mockResolvedValue(150n);
    publicClient.getContractEvents.mockResolvedValue([]);
    await chain().findMint(NONCE);
    expect(publicClient.getContractEvents.mock.calls.map(([a]) => [a.fromBlock, a.toBlock])).toEqual([[0n, 150n]]);
  });
});

describe('writes', () => {
  test('refuses to simulate or send against an RPC on another chain', async () => {
    publicClient.getChainId.mockResolvedValue(8453);
    const c = chain();
    expect(await c.simulateReceive('0x01', '0x02')).toMatchObject({ ok: false, transient: true, detail: expect.stringMatching(/not Base Sepolia/) });
    await expect(c.sendReceive('0x01', '0x02')).rejects.toThrow(/not Base Sepolia/);
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  test('classifies an empty account as insufficient_funds, whichever error the node gives', async () => {
    walletClient.writeContract.mockRejectedValueOnce(new InsufficientFundsError({ cause: new BaseError('x') }));
    await expect(chain().sendReceive('0x01', '0x02')).rejects.toMatchObject({ kind: 'insufficient_funds' });

    // Gas estimation fails first on an empty account; the balance decides.
    walletClient.writeContract.mockRejectedValueOnce(new BaseError('Execution reverted', { details: 'gas required exceeds allowance (0)' }));
    await expect(chain().sendReceive('0x01', '0x02')).rejects.toMatchObject({ kind: 'insufficient_funds' });

    publicClient.getBalance.mockResolvedValue(10n ** 16n);
    walletClient.writeContract.mockRejectedValueOnce(new BaseError('nonce too low'));
    const err = await chain().sendReceive('0x01', '0x02').catch((e) => e);
    expect(err).toBeInstanceOf(SendError);
    expect(err.kind).toBe('failed');
  });

  test('isNonceUsed reads usedNonces', async () => {
    publicClient.readContract.mockResolvedValueOnce(1n).mockResolvedValueOnce(0n);
    expect(await chain().isNonceUsed(NONCE)).toBe(true);
    expect(await chain().isNonceUsed(NONCE)).toBe(false);
    expect(publicClient.readContract.mock.calls[0][0]).toMatchObject({ functionName: 'usedNonces', args: [NONCE] });
  });
});
