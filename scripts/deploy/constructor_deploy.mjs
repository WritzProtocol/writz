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

const { Account, Address, Operation, TransactionBuilder, xdr, rpc: SorobanRpc } = StellarSdk;

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
  const sendAndWait = async (tx) => {
    const sent = await server.sendTransaction(tx);
    if (sent.status === 'ERROR') throw new Error(`submit failed: ${JSON.stringify(sent.errorResult)}`);
    for (let i = 0; i < 60; i++) {
      const res = await server.getTransaction(sent.hash);
      if (res.status === 'SUCCESS') return res;
      if (res.status === 'FAILED') throw new Error(`tx ${sent.hash} failed`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(`tx ${sent.hash} timed out`);
  };

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
export async function buildSigned(server, networkPassphrase, keypair, op) {
  const loaded = await server.getAccount(keypair.publicKey());
  // Every build bumps the account's sequence number, so each starts from a copy.
  const account = () => new Account(loaded.accountId(), loaded.sequenceNumber());
  const build = (data) => new TransactionBuilder(account(), { fee: INCLUSION_FEE.toString(), networkPassphrase })
    .setSorobanData(data)
    .addOperation(op)
    .setTimeout(120)
    .build();
  const probe = new TransactionBuilder(account(), { fee: INCLUSION_FEE.toString(), networkPassphrase })
    .addOperation(op)
    .setTimeout(120)
    .build();
  const sim = await server.simulateTransaction(probe);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`simulation failed: ${JSON.stringify(sim.error)}`);
  }
  const resourceFee = (BigInt(sim.minResourceFee) * 120n) / 100n;

  if (resourceFee + INCLUSION_FEE <= UINT32_MAX) {
    const data = sim.transactionData.setResourceFee(resourceFee).build();
    const tx = SorobanRpc.assembleTransaction(build(data), sim).setSorobanData(data).build();
    tx.sign(keypair);
    return tx;
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
  const inner = TransactionBuilder.fromXDR(envelope.toXDR('base64'), networkPassphrase);
  inner.sign(keypair);
  const bump = TransactionBuilder.buildFeeBumpTransaction(keypair, INCLUSION_FEE.toString(), inner, networkPassphrase);
  bump.sign(keypair);
  return bump;
}

/** A Soroban wasm id is the sha256 of the uploaded bytes. */
function wasmHashFromHash(wasm) {
  return crypto.createHash('sha256').update(wasm).digest();
}
