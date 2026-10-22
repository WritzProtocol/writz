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

const { Address, Operation, TransactionBuilder, xdr, rpc: SorobanRpc } = StellarSdk;

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
  const uploadTx = await buildAndAssemble(server, networkPassphrase, keypair.publicKey(), uploadOp);
  uploadTx.sign(keypair);
  await sendAndWait(uploadTx);
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
  const createTx = await buildAndAssemble(server, networkPassphrase, keypair.publicKey(), createOp);
  createTx.sign(keypair);
  const createRes = await sendAndWait(createTx);
  return Address.fromScAddress(createRes.returnValue.address()).toString();
}

async function buildAndAssemble(server, networkPassphrase, publicKey, op) {
  const account = await server.getAccount(publicKey);
  const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase })
    .addOperation(op)
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`simulation failed: ${JSON.stringify(sim.error)}`);
  }
  return SorobanRpc.assembleTransaction(tx, sim).build();
}

/** A Soroban wasm id is the sha256 of the uploaded bytes. */
function wasmHashFromHash(wasm) {
  return crypto.createHash('sha256').update(wasm).digest();
}
