import {
  buildSPVProof,
  UnconfirmedTxError,
  InsufficientConfirmationsError,
  SPVProofBundle,
} from '../src/bitcoin/spv.js';
import { EsploraClient, TxInfo, MerkleProofResponse } from '../src/bitcoin/esplora.js';

// 80-byte block header (all zeros — correct length, not a valid header).
const FAKE_HEADER = '00'.repeat(80);

// A 32-byte (64 hex chars) fake hash.
const FAKE_HASH = 'ab'.repeat(32);

// A minimal non-witness legacy tx (same shape as makeLegacyTx in tx.test.ts).
const LEGACY_TX_HEX = Buffer.concat([
  Buffer.from('01000000', 'hex'),
  Buffer.from([0x01]),
  Buffer.alloc(32, 0x00),
  Buffer.from([0xff, 0xff, 0xff, 0xff]),
  Buffer.from([0x02, 0x01, 0x01]),
  Buffer.from([0xff, 0xff, 0xff, 0xff]),
  Buffer.from([0x01]),
  Buffer.from('e803000000000000', 'hex'),
  Buffer.from([0x19]),
  Buffer.from('76a914' + 'aa'.repeat(20) + '88ac', 'hex'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
]).toString('hex');

// A minimal SegWit tx with a single-item empty witness.
const SEGWIT_TX_FULL = Buffer.concat([
  Buffer.from('01000000', 'hex'),
  Buffer.from([0x00, 0x01]),          // marker + flag
  Buffer.from([0x01]),
  Buffer.alloc(32, 0x00),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from([0x00]),                // empty scriptSig
  Buffer.from([0xff, 0xff, 0xff, 0xff]),
  Buffer.from([0x01]),
  Buffer.from('e803000000000000', 'hex'),
  Buffer.from([0x16]),
  Buffer.from('0014' + 'bb'.repeat(20), 'hex'),
  Buffer.from([0x01, 0x00]),          // 1 witness item, length 0
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
]).toString('hex');

const SEGWIT_TX_NO_WITNESS = Buffer.concat([
  Buffer.from('01000000', 'hex'),
  Buffer.from([0x01]),
  Buffer.alloc(32, 0x00),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from([0x00]),
  Buffer.from([0xff, 0xff, 0xff, 0xff]),
  Buffer.from([0x01]),
  Buffer.from('e803000000000000', 'hex'),
  Buffer.from([0x16]),
  Buffer.from('0014' + 'bb'.repeat(20), 'hex'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
]).toString('hex');

// ── Mock helpers ─────────────────────────────────────────────────────────────

const TXID = 'de'.repeat(32);
const BLOCK_HEIGHT = 800_000;

function makeMockEsplora(overrides: Partial<{
  txInfo: TxInfo;
  tipHeight: number;
  rawTx: string;
  merkleProof: MerkleProofResponse;
  blockHash: string;
  blockHeader: string;
}> = {}): jest.Mocked<EsploraClient> {
  const defaults = {
    txInfo: {
      txid: TXID,
      status: { confirmed: true, block_height: BLOCK_HEIGHT, block_hash: FAKE_HASH, block_time: 1_700_000_000 },
    },
    tipHeight: BLOCK_HEIGHT + 10,
    rawTx: LEGACY_TX_HEX,
    merkleProof: { block_height: BLOCK_HEIGHT, merkle: [FAKE_HASH], pos: 5 } as MerkleProofResponse,
    blockHash: FAKE_HASH,
    blockHeader: FAKE_HEADER,
    ...overrides,
  };

  return {
    getTxInfo:           jest.fn().mockResolvedValue(defaults.txInfo),
    getTipHeight:        jest.fn().mockResolvedValue(defaults.tipHeight),
    getRawTx:            jest.fn().mockResolvedValue(defaults.rawTx),
    getMerkleProof:      jest.fn().mockResolvedValue(defaults.merkleProof),
    getBlockHashAtHeight: jest.fn().mockResolvedValue(defaults.blockHash),
    getBlockHeader:      jest.fn().mockResolvedValue(defaults.blockHeader),
  } as unknown as jest.Mocked<EsploraClient>;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('buildSPVProof', () => {
  test('returns a complete bundle for a confirmed legacy tx', async () => {
    const esplora = makeMockEsplora();
    const bundle = await buildSPVProof(TXID, 6, esplora);

    expect(bundle.txid).toBe(TXID);
    expect(bundle.blockHeight).toBe(BLOCK_HEIGHT);
    expect(bundle.confirmations).toBe(6);
    expect(bundle.headers).toHaveLength(6);
    expect(bundle.headers[0]).toBe(FAKE_HEADER);
    expect(bundle.txIndex).toBe(5);
    expect(bundle.merkleProof).toEqual([FAKE_HASH]);
    // Legacy tx has no witness data — rawTxNoWitness == rawTx.
    expect(bundle.rawTxNoWitness).toBe(LEGACY_TX_HEX);
  });

  test('fetches exactly N block headers starting at blockHeight', async () => {
    const esplora = makeMockEsplora();
    await buildSPVProof(TXID, 3, esplora);

    expect(esplora.getBlockHashAtHeight).toHaveBeenCalledTimes(3);
    expect(esplora.getBlockHashAtHeight).toHaveBeenCalledWith(BLOCK_HEIGHT);
    expect(esplora.getBlockHashAtHeight).toHaveBeenCalledWith(BLOCK_HEIGHT + 1);
    expect(esplora.getBlockHashAtHeight).toHaveBeenCalledWith(BLOCK_HEIGHT + 2);
    expect(esplora.getBlockHeader).toHaveBeenCalledTimes(3);
  });

  test('strips witness data from a SegWit transaction', async () => {
    const esplora = makeMockEsplora({ rawTx: SEGWIT_TX_FULL });
    const bundle = await buildSPVProof(TXID, 6, esplora);
    expect(bundle.rawTxNoWitness).toBe(SEGWIT_TX_NO_WITNESS);
  });

  test('throws UnconfirmedTxError when the tx has not been mined', async () => {
    const esplora = makeMockEsplora({
      txInfo: {
        txid: TXID,
        status: { confirmed: false, block_height: null, block_hash: null, block_time: null },
      },
    });
    await expect(buildSPVProof(TXID, 6, esplora)).rejects.toThrow(UnconfirmedTxError);
    await expect(buildSPVProof(TXID, 6, esplora)).rejects.toMatchObject({ txid: TXID });
  });

  test('throws InsufficientConfirmationsError when chain is too short', async () => {
    const esplora = makeMockEsplora({ tipHeight: BLOCK_HEIGHT + 2 }); // only 3 available
    await expect(buildSPVProof(TXID, 6, esplora)).rejects.toThrow(InsufficientConfirmationsError);
    await expect(buildSPVProof(TXID, 6, esplora)).rejects.toMatchObject({
      requested: 6,
      available: 3,
    });
  });

  test('throws for confirmations < 1', async () => {
    const esplora = makeMockEsplora();
    await expect(buildSPVProof(TXID, 0, esplora)).rejects.toThrow('confirmations must be ≥ 1');
  });

  test('exactAvailable == requested does not throw', async () => {
    // tip = block_height + 6 - 1 → 6 blocks available
    const esplora = makeMockEsplora({ tipHeight: BLOCK_HEIGHT + 5 });
    const bundle = await buildSPVProof(TXID, 6, esplora);
    expect(bundle.confirmations).toBe(6);
  });

  test('calls getTipHeight and getTxInfo exactly once per invocation', async () => {
    const esplora = makeMockEsplora();
    await buildSPVProof(TXID, 6, esplora);
    expect(esplora.getTxInfo).toHaveBeenCalledTimes(1);
    expect(esplora.getTipHeight).toHaveBeenCalledTimes(1);
  });

  test('calls getMerkleProof and getRawTx exactly once per invocation', async () => {
    const esplora = makeMockEsplora();
    await buildSPVProof(TXID, 6, esplora);
    expect(esplora.getMerkleProof).toHaveBeenCalledTimes(1);
    expect(esplora.getRawTx).toHaveBeenCalledTimes(1);
  });
});
