#!/usr/bin/env node
/**
 * Keeps deployed contracts live: extends each contract's instance and its
 * wasm to a target date with ExtendFootprintTTL.
 *
 * A new wasm and a new instance live for the network's minimum persistent TTL
 * (7 days today). Once archived, the next call must restore the wasm, which
 * costs about what uploading it did: on testnet that is more than a wallet
 * transaction can carry. The contracts never extend their own instance or
 * wasm in user calls, so that rent stays with the operator. Extending the
 * wasm costs rent for its full size per day, so the run is a dry run unless
 * `--execute` is passed, and prints the simulated fee of each extension.
 *
 * Signs with a stellar CLI identity (`stellar keys generate <name>`), by
 * name: no secret is read here or printed. Transactions above the uint32 fee
 * cap go through a fee bump (see `buildSigned`); MAX_RESOURCE_FEE_XLM caps
 * what is signed.
 *
 * Usage:
 *   node extend_ttl.mjs --source <identity> --until 2026-11-30 [--network testnet|mainnet] [--execute] C... [C...]
 *
 * RPC_URL overrides the network's RPC (mainnet has no default).
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import { execFileSync } from 'child_process';
import { buildSigned, sendAndConfirm } from './constructor_deploy.mjs';

const { Address, Networks, Operation, SorobanDataBuilder, StrKey, TransactionBuilder, xdr, rpc: SorobanRpc } = StellarSdk;

const LEDGER_SECONDS = 5;
const MAX_ENTRY_TTL = 3_110_400;
const NETWORKS = {
  testnet: { rpc: 'https://soroban-testnet.stellar.org', passphrase: Networks.TESTNET },
  mainnet: { rpc: undefined, passphrase: Networks.PUBLIC },
};

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const source = flag('--source');
const until = flag('--until');
const networkName = flag('--network') ?? 'testnet';
const execute = args.includes('--execute');
const contracts = args.filter((a) => a !== '--execute');

const fail = (msg) => { console.error(msg); process.exit(1); };
if (!source || !/^[A-Za-z0-9_-]+$/.test(source)) fail('--source <stellar CLI identity name> is required');
if (!until || Number.isNaN(Date.parse(`${until}T00:00:00Z`))) fail('--until YYYY-MM-DD is required');
if (!(networkName in NETWORKS)) fail('--network must be testnet or mainnet');
if (!contracts.length || !contracts.every((c) => StrKey.isValidContract(c))) fail('pass one or more contract ids (C...)');
const { passphrase } = NETWORKS[networkName];
const rpcUrl = process.env.RPC_URL ?? NETWORKS[networkName].rpc;
if (!rpcUrl) fail('RPC_URL is required on mainnet');

const cli = (cmdArgs, input) => execFileSync('stellar', cmdArgs, { input, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
const publicKey = cli(['keys', 'address', source]);
const signer = { publicKey: () => publicKey };
const sign = async (tx) => TransactionBuilder.fromXDR(
  cli(['tx', 'sign', '--sign-with-key', source, '--network-passphrase', passphrase, '--rpc-url', rpcUrl], tx.toXDR()),
  passphrase,
);

const server = new SorobanRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
const latest = (await server.getLatestLedger()).sequence;
const secondsLeft = (Date.parse(`${until}T00:00:00Z`) - Date.now()) / 1000;
const extendTo = Math.min(MAX_ENTRY_TTL, Math.ceil(secondsLeft / LEDGER_SECONDS));
if (extendTo <= 0) fail(`${until} is in the past`);
console.log(`${networkName}, ledger ${latest}: extend to ${extendTo} ledgers (${until}), signer ${publicKey}${execute ? '' : ', dry run'}`);

const instanceKey = (id) => xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
  contract: Address.fromString(id).toScAddress(),
  key: xdr.ScVal.scvLedgerKeyContractInstance(),
  durability: xdr.ContractDataDurability.persistent(),
}));
const codeKey = (hash) => xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash }));

for (const id of contracts) {
  const { entries } = await server.getLedgerEntries(instanceKey(id));
  if (!entries.length) fail(`${id}: no live instance (archived or unknown); restore it first`);
  const wasmHash = entries[0].val.contractData().val().instance().executable().wasmHash();
  const code = (await server.getLedgerEntries(codeKey(wasmHash))).entries[0];
  const targets = [
    [`${id} instance`, instanceKey(id), entries[0].liveUntilLedgerSeq],
    [`${id} wasm ${wasmHash.toString('hex').slice(0, 12)}`, codeKey(wasmHash), code?.liveUntilLedgerSeq],
  ];
  for (const [label, key, liveUntil] of targets) {
    if (liveUntil === undefined) fail(`${label}: not live (archived); restore it first`);
    if (liveUntil - latest >= extendTo) { console.log(`  ${label}: live until ${liveUntil}, nothing to do`); continue; }
    const sorobanData = new SorobanDataBuilder().setReadOnly([key]).build();
    const op = Operation.extendFootprintTtl({ extendTo });
    const probe = new TransactionBuilder(await server.getAccount(publicKey), { fee: '100', networkPassphrase: passphrase })
      .setSorobanData(sorobanData).addOperation(op).setTimeout(60).build();
    const sim = await server.simulateTransaction(probe);
    if (SorobanRpc.Api.isSimulationError(sim)) fail(`${label}: simulation failed: ${sim.error}`);
    const fee = (Number(sim.minResourceFee) / 1e7).toFixed(2);
    if (!execute) { console.log(`  ${label}: live until ${liveUntil}, extension ~${fee} XLM`); continue; }
    const tx = await buildSigned(server, passphrase, signer, op, { sign, sorobanData });
    const res = await sendAndConfirm(server, tx);
    console.log(`  ${label}: extended (~${fee} XLM simulated), tx ${tx.hash().toString('hex')} at ledger ${res.ledger}`);
  }
}
