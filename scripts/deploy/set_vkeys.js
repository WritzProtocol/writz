#!/usr/bin/env node
/**
 * Sets all three Groth16 verification keys on the deployed zk-verifier contract.
 *
 * Usage:
 *   node set_vkeys.js
 *
 * Reads vkey JSON files from circuits/keys/ and calls set_verification_key
 * for Deposit, BorrowRepay, and Liquidation circuits.
 */
import * as StellarSdk from '@stellar/stellar-sdk';
const { Keypair, Networks, TransactionBuilder, BASE_FEE, Contract, Address, xdr, rpc: SorobanRpc } = StellarSdk;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL     = 'https://soroban-testnet.stellar.org';
const NETWORK     = Networks.TESTNET;
const ZK_VERIFIER = 'CDV45GLXG4AOU6BDZSY5YHHVNGQIAYAPD3PUGXIIIYLIO6V2XGO6SMFV';

// writz-dev secret key — testnet only, no real funds
const SECRET = process.env.WRITZ_DEV_SECRET;
if (!SECRET) {
    console.error('Set WRITZ_DEV_SECRET env var to the writz-dev secret key');
    process.exit(1);
}

const keypair = Keypair.fromSecret(SECRET);
const server  = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

// ── Encoding helpers ──────────────────────────────────────────────────────────

function decToHex32(s) {
    const n = BigInt(s);
    return n.toString(16).padStart(64, '0');
}

function g1ToBytes(point) {
    const hex = decToHex32(point[0]) + decToHex32(point[1]);
    return Buffer.from(hex, 'hex');
}

// G2: EIP-197 order — be(x.c1) || be(x.c0) || be(y.c1) || be(y.c0)
function g2ToBytes(point) {
    const xc0 = point[0][0], xc1 = point[0][1];
    const yc0 = point[1][0], yc1 = point[1][1];
    const hex = decToHex32(xc1) + decToHex32(xc0) + decToHex32(yc1) + decToHex32(yc0);
    return Buffer.from(hex, 'hex');
}

function g1ToScVal(point) {
    const bytes = g1ToBytes(point);
    return xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('bytes'),
            val: xdr.ScVal.scvBytes(bytes),
        }),
    ]);
}

function g2ToScVal(point) {
    const bytes = g2ToBytes(point);
    return xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('bytes'),
            val: xdr.ScVal.scvBytes(bytes),
        }),
    ]);
}

function vkeyToScVal(vkey) {
    const icVec = xdr.ScVal.scvVec(vkey.IC.map(g1ToScVal));
    return xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('alpha_g1'), val: g1ToScVal(vkey.vk_alpha_1) }),
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('beta_g2'),  val: g2ToScVal(vkey.vk_beta_2) }),
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('delta_g2'), val: g2ToScVal(vkey.vk_delta_2) }),
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('gamma_g2'), val: g2ToScVal(vkey.vk_gamma_2) }),
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('ic'),       val: icVec }),
    ]);
}

function circuitIdToScVal(name) {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);
}

// ── Transaction helper ────────────────────────────────────────────────────────

async function invoke(contractId, method, args) {
    // Retry on txBadSeq: after a prior tx, the RPC account sequence can lag, so
    // re-fetch the account and rebuild before retrying.
    for (let attempt = 1; attempt <= 5; attempt++) {
        const account = await server.getAccount(keypair.publicKey());
        const contract = new Contract(contractId);

        const tx = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: NETWORK,
        })
            .addOperation(contract.call(method, ...args))
            .setTimeout(30)
            .build();

        const simResult = await server.simulateTransaction(tx);
        if (SorobanRpc.Api.isSimulationError(simResult)) {
            throw new Error(`Simulation failed: ${JSON.stringify(simResult.error)}`);
        }

        const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
        preparedTx.sign(keypair);

        const sendResult = await server.sendTransaction(preparedTx);
        if (sendResult.status === 'ERROR') {
            if (JSON.stringify(sendResult).includes('txBadSeq') && attempt < 5) {
                await new Promise(r => setTimeout(r, 2500));
                continue;
            }
            throw new Error(`Send failed: ${JSON.stringify(sendResult)}`);
        }

        // Poll until confirmed
        let getResult;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 1500));
            getResult = await server.getTransaction(sendResult.hash);
            if (getResult.status !== 'NOT_FOUND') break;
        }

        if (getResult.status !== 'SUCCESS') {
            // Not confirmed (e.g. dropped / NOT_FOUND) — rebuild with a fresh
            // sequence and retry.
            if (attempt < 5) {
                await new Promise(r => setTimeout(r, 2500));
                continue;
            }
            throw new Error(`Transaction failed: ${getResult.status}\n${JSON.stringify(getResult)}`);
        }

        return { hash: sendResult.hash };
    }

    throw new Error('Exhausted retries');
}

// ── Main ──────────────────────────────────────────────────────────────────────

const circuits = [
    { name: 'Deposit',    file: 'deposit_vkey.json' },
    { name: 'BorrowRepay', file: 'borrow_repay_vkey.json' },
    { name: 'Liquidation', file: 'liquidation_vkey.json' },
];

for (const { name, file } of circuits) {
    const vkeyPath = path.join(ROOT, 'circuits/keys', file);
    const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));

    console.log(`\nSetting VK for ${name} (IC length: ${vkey.IC.length})…`);

    const { hash } = await invoke(ZK_VERIFIER, 'set_verification_key', [
        Address.fromString(keypair.publicKey()).toScVal(),
        circuitIdToScVal(name),
        vkeyToScVal(vkey),
    ]);

    console.log(`✓ ${name} VK set — tx ${hash}`);
    console.log(`  https://stellar.expert/explorer/testnet/tx/${hash}`);
}

console.log('\n✅ All verification keys set.');
