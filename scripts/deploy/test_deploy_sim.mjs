import * as StellarSdk from '@stellar/stellar-sdk';
const { Keypair, Networks, TransactionBuilder, Address, rpc: SorobanRpc, Operation, StrKey } = StellarSdk;
import crypto from 'crypto';
const keypair = Keypair.fromSecret('SBDHJ6HOFLXGTJ3ECECMU5QU3ATPMNT75GRS7B4HVWRMLXVQISXGDADC');
const server = new SorobanRpc.Server('https://soroban-testnet.stellar.org');
const wasmHash = Buffer.from('28422f9213f1b624942634158c7504b1efc68f2debc3d9892563cf201a1da43d', 'hex');
const account = await server.getAccount(keypair.publicKey());
const deployOp = Operation.createCustomContract({
  wasmHash,
  address: Address.fromString(keypair.publicKey()),
  salt: crypto.randomBytes(32),
});
const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET })
  .addOperation(deployOp).setTimeout(30).build();
const sim = await server.simulateTransaction(tx);
if (sim.error) { console.log('sim error:', sim.error); process.exit(1); }
const rv = sim.result?.retval;
console.log('retval switch:', rv?.switch?.().name);
if (rv?.switch?.().name === 'scvAddress') {
  const contractId = rv.address().contractId();
  console.log('contract ID:', StrKey.encodeContract(contractId));
}
