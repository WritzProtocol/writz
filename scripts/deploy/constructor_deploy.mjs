/**
 * Deploys a Soroban contract whose `__constructor` takes arguments, in a
 * single transaction (CreateContractV2). Used instead of a separate
 * `initialize` call so no one can front-run contract configuration
 * (GHSA-422m-f73x-fh58).
 *
 * The caller provides already-converted ScVal constructor arguments
 * (see `nativeToScVal` in @stellar/stellar-sdk).
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import crypto from 'crypto';

const { Account, Address, Networks, Operation, TransactionBuilder, xdr, rpc: SorobanRpc } = StellarSdk;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Submits a signed transaction and waits for its result.
 *
 * - `TRY_AGAIN_LATER`: the node is not taking it now; resubmits the same
 *   signed envelope with a growing back-off, a bounded number of times.
 * - `DUPLICATE`: the node already has it; waits for the result by hash.
 * - `ERROR`: throws with the result code. A bad sequence number carries
 *   `txBadSeq` in the message so a caller can rebuild and retry.
 */
export async function sendAndConfirm(server, tx, { retries = 6, polls = 60 } = {}) {
  const hash = tx.hash().toString('hex');
  let sent;
  for (let attempt = 0; ; attempt++) {
    sent = await server.sendTransaction(tx);
    if (sent.status !== 'TRY_AGAIN_LATER') break;
    if (attempt >= retries) throw new Error(`tx ${hash}: node kept answering TRY_AGAIN_LATER`);
    await sleep(2000 * 2 ** attempt);
  }
  if (sent.status === 'ERROR') {
    const code = sent.errorResult?.result()?.switch()?.name ?? 'unknown';
    throw new Error(`tx ${hash} rejected: ${code}`);
  }
  // PENDING or DUPLICATE: either way the result is found by hash.
  for (let i = 0; i < polls; i++) {
    const res = await server.getTransaction(hash);
    if (res.status === 'SUCCESS') return res;
    if (res.status === 'FAILED') throw new Error(`tx ${hash} failed`);
    await sleep(1500);
  }
  throw new Error(`tx ${hash} timed out (${sent.status})`);
}

/**
 * Most resource fee, in XLM, `buildSigned` will sign for. From
 * `MAX_RESOURCE_FEE_XLM`; required on mainnet, where a mistaken fee is real
 * money. Unset elsewhere means no limit.
 */
function maxResourceFeeStroops(networkPassphrase) {
  const raw = process.env.MAX_RESOURCE_FEE_XLM?.trim();
  if (!raw) {
    if (networkPassphrase === Networks.PUBLIC) {
      throw new Error('MAX_RESOURCE_FEE_XLM must be set on mainnet: the most resource fee, in XLM, to sign for');
    }
    return undefined;
  }
  if (!/^\d+(\.\d{1,7})?$/.test(raw)) throw new Error(`MAX_RESOURCE_FEE_XLM is not an XLM amount: ${raw}`);
  const [whole, frac = ''] = raw.split('.');
  return BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, '0'));
}

const xlm = (stroops) => `${(Number(stroops) / 1e7).toFixed(2)} XLM`;

/**
 * Builds the unsigned upload + create transactions, simulates, assembles and
 * submits them, and returns the new contract id.
 *
 * @param {object} p
 * @param {SorobanRpc.Server} p.server
 * @param {string} p.networkPassphrase
 * @param {StellarSdk.Keypair} p.keypair   deployer; must also be the tx source
 * @param {Buffer} p.wasm                  compiled contract bytes
 * @param {xdr.ScVal[]} p.constructorArgs  converted constructor arguments
 */
export async function deployWithConstructor({ server, networkPassphrase, keypair, wasm, constructorArgs }) {
  const sendAndWait = (tx) => sendAndConfirm(server, tx);

  const uploadOp = Operation.uploadContractWasm({ wasm });
  await sendAndWait(await buildSigned(server, networkPassphrase, keypair, uploadOp));
  const wasmHash = wasmHashFromHash(wasm);

  const salt = crypto.randomBytes(32);
  const createArgs = new xdr.CreateContractArgsV2({
    contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new xdr.ContractIdPreimageFromAddress({
        address: Address.fromString(keypair.publicKey()).toScAddress(),
        salt,
      }),
    ),
    executable: xdr.ContractExecutable.contractExecutableWasm(wasmHash),
    constructorArgs,
  });
  const createOp = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeCreateContractV2(createArgs),
    auth: [],
  });
  const createRes = await sendAndWait(await buildSigned(server, networkPassphrase, keypair, createOp));
  return Address.fromScAddress(createRes.returnValue.address()).toString();
}

const INCLUSION_FEE = 1_000_000n;
const UINT32_MAX = 4_294_967_295n;

/**
 * Simulates `op`, declares its resource fee with a margin (rent is priced at
 * the ledger that applies the transaction, and it rises while the network's
 * live state is above its target size; anything unused is refunded), and
 * returns the transaction signed by `keypair`.
 *
 * A transaction's fee is a uint32, so it can carry at most 429.4967295 XLM.
 * Uploading a contract's wasm on a network whose rent is priced high (testnet
 * since October 2026: several thousand XLM) needs more, so above that the
 * transaction is wrapped in a fee bump, whose fee is an int64: the inner
 * transaction keeps a small fee and the outer one pays the resource fee.
 */
export async function buildSigned(server, networkPassphrase, keypair, op, { sign, sorobanData } = {}) {
  // `sign` lets a caller sign elsewhere (a stellar CLI identity) instead of
  // with a Keypair in this process; `keypair` then only needs publicKey().
  const signTx = sign ?? (async (tx) => { tx.sign(keypair); return tx; });
  const maxFee = maxResourceFeeStroops(networkPassphrase);
  const loaded = await server.getAccount(keypair.publicKey());
  // Every build bumps the account's sequence number, so each starts from a copy.
  const account = () => new Account(loaded.accountId(), loaded.sequenceNumber());
  const build = (data) => new TransactionBuilder(account(), { fee: INCLUSION_FEE.toString(), networkPassphrase })
    .setSorobanData(data)
    .addOperation(op)
    .setTimeout(120)
    .build();
  const probeBuilder = new TransactionBuilder(account(), { fee: INCLUSION_FEE.toString(), networkPassphrase });
  // ExtendFootprintTTL and RestoreFootprint name their entries in the footprint.
  if (sorobanData) probeBuilder.setSorobanData(sorobanData);
  const probe = probeBuilder
    .addOperation(op)
    .setTimeout(120)
    .build();
  const sim = await server.simulateTransaction(probe);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`simulation failed: ${JSON.stringify(sim.error)}`);
  }
  const resourceFee = (BigInt(sim.minResourceFee) * 120n) / 100n;
  if (maxFee !== undefined && resourceFee > maxFee) {
    throw new Error(
      `refusing to sign: simulated resource fee ${xlm(BigInt(sim.minResourceFee))} ` +
      `(${xlm(resourceFee)} with the 20% margin) is above MAX_RESOURCE_FEE_XLM (${xlm(maxFee)})`,
    );
  }

  if (resourceFee + INCLUSION_FEE <= UINT32_MAX) {
    const data = sim.transactionData.setResourceFee(resourceFee).build();
    const tx = SorobanRpc.assembleTransaction(build(data), sim).setSorobanData(data).build();
    return signTx(tx);
  }

  // The SDK refuses to build a transaction whose fee would not fit a uint32,
  // so build it with no resource fee and set the real one in the envelope.
  const zero = sim.transactionData.setResourceFee(0).build();
  const assembled = SorobanRpc.assembleTransaction(build(zero), { ...sim, transactionData: { build: () => zero } })
    .setSorobanData(zero)
    .build();
  const envelope = assembled.toEnvelope();
  envelope.v1().tx().ext().sorobanData().resourceFee(xdr.Int64.fromString(resourceFee.toString()));
  envelope.v1().tx().fee(Number(INCLUSION_FEE));
  const inner = await signTx(TransactionBuilder.fromXDR(envelope.toXDR('base64'), networkPassphrase));
  const bump = TransactionBuilder.buildFeeBumpTransaction(keypair.publicKey(), INCLUSION_FEE.toString(), inner, networkPassphrase);
  return signTx(bump);
}

/** A Soroban wasm id is the sha256 of the uploaded bytes. */
function wasmHashFromHash(wasm) {
  return crypto.createHash('sha256').update(wasm).digest();
}
