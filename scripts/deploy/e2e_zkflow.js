#!/usr/bin/env node
/**
 * End-to-end ZK flow test on Soroban testnet.
 *
 * Runs the full: deposit → insert_commitment → borrow → repay cycle
 * using real Groth16 ZK proofs generated with snarkjs.
 *
 * Uses XLM native (via SAC) as the test USDC token so we don't need
 * Circle USDC faucet access. Deploys a fresh commitment-tree instance
 * for the test (separate from the production deployment).
 *
 * Usage:
 *   WRITZ_DEV_SECRET=<key> node e2e_zkflow.js
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import * as snarkjs from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CIRCUITS = path.join(ROOT, 'circuits');
const CONTRACTS = path.join(ROOT, 'contracts');

// ── Stellar SDK destructuring ─────────────────────────────────────────────────

const {
    Keypair, Networks, TransactionBuilder, BASE_FEE, Contract,
    Address, xdr, rpc: SorobanRpc,
} = StellarSdk;

// ── Constants ─────────────────────────────────────────────────────────────────

const RPC_URL       = 'https://soroban-testnet.stellar.org';
const NETWORK       = Networks.TESTNET;
const SPV_CONTRACT  = 'CAE5L7BO2GNF7MIZWXB2BTUMLYNIMQZUSWN2BWLZQS7HRHLOUSL6VLWJ';
const ZK_VERIFIER   = 'CDV45GLXG4AOU6BDZSY5YHHVNGQIAYAPD3PUGXIIIYLIO6V2XGO6SMFV';
// XLM native Stellar Asset Contract — no trustline needed, always available
const XLM_SAC       = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// ZK circuit parameters
const COLLATERAL_SATS     = 1_000_000n;  // 0.01 BTC ($600 at $60k)
const SECRET              = 0xdeadbeef12345678n;
const NONCE               = 0x8765432112345678n;
const NEW_NONCE           = 0xaabbccdd99887766n;
const REPAY_NONCE         = 0x1122334455667788n;
const BORROW_AMOUNT       = 2_000_000_000n;  // 200 USDC stroops ($200)
const PRICE_STROOPS       = 600_000_000_000n; // $60k in stroops/BTC
const MIN_RATIO_BP        = 15_000n;          // 150%
const SUPPLY_AMOUNT       = 5_000_000_000n;   // 500 XLM stroops to pool
const MIN_CONFIRMATIONS   = 1;
const MIN_DEPOSIT_SATS    = 100_000n;         // 0.001 BTC

// Fake Bitcoin raw transaction for testing
const RAW_TX_HEX = '010000000000000000';

// ── Setup ─────────────────────────────────────────────────────────────────────

const SECRET_KEY = process.env.WRITZ_DEV_SECRET;
if (!SECRET_KEY) { console.error('Set WRITZ_DEV_SECRET env var'); process.exit(1); }

const keypair = Keypair.fromSecret(SECRET_KEY);
const server  = new SorobanRpc.Server(RPC_URL);

console.log(`\n🔑 Deployer: ${keypair.publicKey()}`);

// ── Bitcoin helpers ───────────────────────────────────────────────────────────

function sha256d(data) {
    const h1 = crypto.createHash('sha256').update(data).digest();
    return crypto.createHash('sha256').update(h1).digest();
}

// Build an 80-byte Bitcoin block header where merkle_root = txid (single-tx block).
function buildFakeHeader(txidBuffer) {
    const header = Buffer.alloc(80, 0);
    header.writeUInt32LE(1, 0);      // version
    // prev_block: all zeros (bytes 4-35)
    txidBuffer.copy(header, 36);     // merkle_root at offset 36 (bytes 36-67)
    header.writeUInt32LE(0x65_53_F1_00, 68); // timestamp
    // bits, nonce: all zeros
    return header;
}

// Compute BTC txid from raw_tx hex and return { txidBuf, txidLo, txidHi } for ZK input.
function computeTxid(rawTxHex) {
    const rawTxBuf = Buffer.from(rawTxHex, 'hex');
    const txidBuf  = sha256d(rawTxBuf);
    // lo = bytes 16..32 as BigInt (little 128 bits)
    const txidLo = BigInt('0x' + txidBuf.subarray(16, 32).toString('hex'));
    // hi = bytes 0..16 as BigInt (high 128 bits)
    const txidHi = BigInt('0x' + txidBuf.subarray(0, 16).toString('hex'));
    return { txidBuf, txidLo, txidHi };
}

// ── ZK helpers ────────────────────────────────────────────────────────────────

async function buildPoseidonTree(poseidon, leaf, depth = 20) {
    const F = poseidon.F;
    const zeros = [0n];
    for (let i = 1; i <= depth; i++) {
        zeros[i] = F.toObject(poseidon([zeros[i - 1], zeros[i - 1]]));
    }
    const pathElements = zeros.slice(0, depth);
    const pathIndices  = new Array(depth).fill(0);
    let current = leaf;
    for (let i = 0; i < depth; i++) {
        current = F.toObject(poseidon([current, zeros[i]]));
    }
    return { root: current, pathElements, pathIndices };
}

async function groth16Prove(circuitName, input) {
    const wasmFile = path.join(CIRCUITS, 'build', `${circuitName}_js`, `${circuitName}.wasm`);
    const zkeyFile = path.join(CIRCUITS, 'keys', `${circuitName}_final.zkey`);
    return snarkjs.groth16.fullProve(input, wasmFile, zkeyFile);
}

// ── Stellar XDR helpers ───────────────────────────────────────────────────────

function decToHex32(s) {
    return BigInt(s).toString(16).padStart(64, '0');
}

function g1ToScVal(point) {
    const hex = decToHex32(point[0]) + decToHex32(point[1]);
    return xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('bytes'), val: xdr.ScVal.scvBytes(Buffer.from(hex, 'hex')) }),
    ]);
}

function g2ToScVal(point) {
    const hex = decToHex32(point[0][1]) + decToHex32(point[0][0])
              + decToHex32(point[1][1]) + decToHex32(point[1][0]);
    return xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('bytes'), val: xdr.ScVal.scvBytes(Buffer.from(hex, 'hex')) }),
    ]);
}

function proofToScVal(proof) {
    return xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('pi_a'), val: g1ToScVal(proof.pi_a) }),
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('pi_b'), val: g2ToScVal(proof.pi_b) }),
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('pi_c'), val: g1ToScVal(proof.pi_c) }),
    ]);
}

function signalsToScVal(publicSignals) {
    return xdr.ScVal.scvVec(publicSignals.map(s => {
        const hex = BigInt(s).toString(16).padStart(64, '0');
        return xdr.ScVal.scvBytes(Buffer.from(hex, 'hex'));
    }));
}

function bytesNToScVal(buf) {
    return xdr.ScVal.scvBytes(buf);
}

function bigIntToScVal(n, bytes = 32) {
    const hex = n.toString(16).padStart(bytes * 2, '0');
    return xdr.ScVal.scvBytes(Buffer.from(hex, 'hex'));
}

function addressToScVal(pub) {
    return Address.fromString(pub).toScVal();
}

function u32ToScVal(n) {
    return xdr.ScVal.scvU32(n);
}

function i128ToScVal(n) {
    // Split into hi (upper 64 bits) and lo (lower 64 bits)
    const lo = n & 0xFFFFFFFFFFFFFFFFn;
    const hi = n >> 64n;
    return xdr.ScVal.scvI128(new xdr.Int128Parts({
        hi: xdr.Int64.fromString(hi.toString()),
        lo: xdr.Uint64.fromString(lo.toString()),
    }));
}

// ── Contract invocation ───────────────────────────────────────────────────────

async function invoke(contractId, method, args) {
    // Retry on testnet flakiness: txBadSeq (sequence lag) or NOT_FOUND (dropped).
    for (let attempt = 1; attempt <= 4; attempt++) {
        const account  = await server.getAccount(keypair.publicKey());
        const contract = new Contract(contractId);

        const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: NETWORK })
            .addOperation(contract.call(method, ...args))
            .setTimeout(30)
            .build();

        const simResult = await server.simulateTransaction(tx);
        if (SorobanRpc.Api.isSimulationError(simResult)) {
            // Transient: RPC state from a prior tx may not have propagated yet.
            if (attempt < 4) {
                await new Promise(r => setTimeout(r, 3000));
                continue;
            }
            throw new Error(`Simulation failed (${method}): ${JSON.stringify(simResult.error)}`);
        }

        const prepared = SorobanRpc.assembleTransaction(tx, simResult).build();
        prepared.sign(keypair);

        const sendResult = await server.sendTransaction(prepared);
        if (sendResult.status === 'ERROR') {
            if (JSON.stringify(sendResult).includes('txBadSeq') && attempt < 4) {
                await new Promise(r => setTimeout(r, 2500));
                continue;
            }
            throw new Error(`Send failed (${method}): ${JSON.stringify(sendResult.errorResult)}`);
        }

        let getResult;
        for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 2000));
            getResult = await server.getTransaction(sendResult.hash);
            if (getResult.status !== 'NOT_FOUND') break;
        }

        if (getResult.status !== 'SUCCESS') {
            if (attempt < 4) {
                await new Promise(r => setTimeout(r, 2500));
                continue;
            }
            throw new Error(`Tx failed (${method}): ${getResult.status}`);
        }

        return { hash: sendResult.hash, result: getResult };
    }
}

// Deploy a Soroban contract from a local WASM file (with retry on flakiness).
async function deployContract(wasmPath) {
    const wasm = fs.readFileSync(wasmPath);
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await deployContractOnce(wasm);
      } catch (e) {
        lastErr = e;
        console.log(`  deploy attempt ${attempt} failed (${e.message}); retrying…`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    throw lastErr;
}

async function deployContractOnce(wasm) {
    // Upload WASM
    const account = await server.getAccount(keypair.publicKey());
    const uploadOp = StellarSdk.Operation.uploadContractWasm({ wasm });
    const uploadTx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: NETWORK })
        .addOperation(uploadOp)
        .setTimeout(30)
        .build();
    const uploadSim = await server.simulateTransaction(uploadTx);
    if (SorobanRpc.Api.isSimulationError(uploadSim)) throw new Error(`WASM upload sim failed: ${JSON.stringify(uploadSim.error)}`);
    // WASM hash is returned as the simulation result value
    const wasmHash = uploadSim.result?.retval?.bytes?.();
    if (!wasmHash) throw new Error('Could not extract WASM hash from simulation');

    const uploadPrep = SorobanRpc.assembleTransaction(uploadTx, uploadSim).build();
    uploadPrep.sign(keypair);
    const uploadSend = await server.sendTransaction(uploadPrep);
    await waitForTx(uploadSend.hash);

    // Deploy contract
    const account2 = await server.getAccount(keypair.publicKey());
    const deployOp = StellarSdk.Operation.createCustomContract({
        wasmHash,
        address: Address.fromString(keypair.publicKey()),
        salt: crypto.randomBytes(32),
    });
    const deployTx = new TransactionBuilder(account2, { fee: '1000000', networkPassphrase: NETWORK })
        .addOperation(deployOp)
        .setTimeout(30)
        .build();
    const deploySim = await server.simulateTransaction(deployTx);
    if (SorobanRpc.Api.isSimulationError(deploySim)) throw new Error(`Deploy sim failed: ${JSON.stringify(deploySim.error)}`);
    // Extract contract ID from simulation (the address is deterministic before tx lands)
    const retVal = deploySim.result?.retval;
    if (!retVal || retVal.switch().name !== 'scvAddress') throw new Error('Deploy sim did not return contract address');
    const contractId = StellarSdk.StrKey.encodeContract(retVal.address().contractId());

    const deployPrep = SorobanRpc.assembleTransaction(deployTx, deploySim).build();
    deployPrep.sign(keypair);
    const deploySend = await server.sendTransaction(deployPrep);
    await waitForTx(deploySend.hash);
    return contractId;
}

async function waitForTx(hash) {
    let result;
    for (let i = 0; i < 45; i++) {
        await new Promise(r => setTimeout(r, 2000));
        result = await server.getTransaction(hash);
        if (result.status !== 'NOT_FOUND') break;
    }
    if (result.status !== 'SUCCESS') throw new Error(`Tx failed: ${result.status}`);
    return result;
}

// ── Main flow ─────────────────────────────────────────────────────────────────

async function main() {
    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    // ── Step 1: Deploy fresh commitment-tree with XLM as token ───────────────
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('STEP 1: Deploy test commitment-tree (XLM as token)');
    console.log('══════════════════════════════════════════════════════════════');

    const wasmPath = path.join(CONTRACTS, 'target/wasm32v1-none/release/commitment_tree.wasm');
    const ctId = await deployContract(wasmPath);
    console.log(`✓ commitment-tree deployed: ${ctId}`);

    const initResult = await invoke(ctId, 'initialize', [
        addressToScVal(keypair.publicKey()), // admin
        addressToScVal(SPV_CONTRACT),         // spv_contract
        addressToScVal(ZK_VERIFIER),          // zk_verifier
        addressToScVal(XLM_SAC),              // usdc_token (XLM for test)
        addressToScVal(keypair.publicKey()),   // oracle (stub ignores it)
        u32ToScVal(MIN_CONFIRMATIONS),         // min_confirmations
    ]);
    console.log(`✓ initialized — tx ${initResult.hash}`);

    // Verify empty Merkle root
    const rootResult = await invoke(ctId, 'get_merkle_root', []);
    console.log(`✓ merkle root: ${rootResult.result.returnValue?.bytes()?.toString('hex')}`);

    // ── Step 2: Supply XLM to the pool ───────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('STEP 2: Supply XLM to pool');
    console.log('══════════════════════════════════════════════════════════════');

    const supplyResult = await invoke(ctId, 'supply_usdc', [
        addressToScVal(keypair.publicKey()),
        i128ToScVal(SUPPLY_AMOUNT),
    ]);
    console.log(`✓ supplied ${SUPPLY_AMOUNT} stroops (${Number(SUPPLY_AMOUNT) / 1e7} XLM) — tx ${supplyResult.hash}`);

    // ── Step 3: Bitcoin SPV — compute txid from raw_tx ───────────────────────
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('STEP 3: Deposit — compute txid and generate ZK proof');
    console.log('══════════════════════════════════════════════════════════════');

    const { txidBuf, txidLo, txidHi } = computeTxid(RAW_TX_HEX);
    console.log(`✓ txid: ${txidBuf.toString('hex')}`);
    console.log(`  txid_lo: ${txidLo.toString(16)}`);
    console.log(`  txid_hi: ${txidHi.toString(16)}`);

    // ── Step 4: Generate deposit ZK proof ────────────────────────────────────

    const depositInput = {
        collateral_satoshis:  COLLATERAL_SATS.toString(),
        secret:               SECRET.toString(),
        nonce:                NONCE.toString(),
        btc_txid_lo:          txidLo.toString(),
        btc_txid_hi:          txidHi.toString(),
        min_deposit_satoshis: MIN_DEPOSIT_SATS.toString(),
    };

    console.log('Generating deposit ZK proof…');
    const { proof: depProof, publicSignals: depSignals } = await groth16Prove('deposit', depositInput);
    console.log(`✓ deposit proof generated`);
    console.log(`  commitment: ${depSignals[0]}`);
    console.log(`  nullifier:  ${depSignals[1]}`);

    const commitment = BigInt(depSignals[0]); // Poseidon(collateral, 0, secret, nonce)

    // ── Step 5: Submit deposit ───────────────────────────────────────────────

    const fakeHeader = buildFakeHeader(txidBuf);
    const headers    = xdr.ScVal.scvVec([bytesNToScVal(fakeHeader)]);
    const btcProof   = xdr.ScVal.scvVec([]);    // empty Merkle proof for single-tx block
    const rawTxBuf   = Buffer.from(RAW_TX_HEX, 'hex');

    const depResult = await invoke(ctId, 'deposit', [
        addressToScVal(keypair.publicKey()),   // depositor
        headers,
        btcProof,
        u32ToScVal(0),                          // tx_index
        bytesNToScVal(rawTxBuf),                // raw_tx
        proofToScVal(depProof),
        signalsToScVal(depSignals),
    ]);
    console.log(`✓ deposit submitted — tx ${depResult.hash}`);
    console.log(`  https://stellar.expert/explorer/testnet/tx/${depResult.hash}`);

    // ── Step 6: Compute new Merkle root and insert commitment ─────────────────
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('STEP 4: Admin inserts commitment into Merkle tree');
    console.log('══════════════════════════════════════════════════════════════');

    const { root: newRoot, pathElements, pathIndices } =
        await buildPoseidonTree(poseidon, commitment);
    console.log(`✓ new Merkle root (off-chain): ${newRoot.toString(16)}`);

    const newRootHex = newRoot.toString(16).padStart(64, '0');
    const insertResult = await invoke(ctId, 'insert_commitment', [
        addressToScVal(keypair.publicKey()),
        bytesNToScVal(Buffer.from(BigInt(depSignals[0]).toString(16).padStart(64, '0'), 'hex')),
        bytesNToScVal(Buffer.from(newRootHex, 'hex')),
    ]);
    console.log(`✓ insert_commitment — tx ${insertResult.hash}`);
    console.log(`  https://stellar.expert/explorer/testnet/tx/${insertResult.hash}`);

    // ── Demo seed mode: stop here and print the config the frontend needs ─────
    if (process.env.SEED_ONLY) {
        console.log('\n══════════════════════════════════════════════════════════════');
        console.log('✅ DEMO SEED COMPLETE — funded pool + one inserted position');
        console.log('══════════════════════════════════════════════════════════════');
        console.log('\nFrontend config — set in frontend/.env.local:');
        console.log(`  NEXT_PUBLIC_COMMITMENT_TREE_ID=${ctId}`);
        console.log(`  NEXT_PUBLIC_USDC_TOKEN_ID=${XLM_SAC}`);
        console.log('\nSeeded position (debt 0) — the app must hold the same secret/nonce:');
        console.log(JSON.stringify({
            collateralSats: COLLATERAL_SATS.toString(),
            debtStroops: '0',
            secret: SECRET.toString(),
            nonce: NONCE.toString(),
            commitment: commitment.toString(),
        }, null, 2));
        return;
    }

    // ── Step 7: Generate borrow ZK proof ─────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('STEP 5: Borrow — generate ZK proof');
    console.log('══════════════════════════════════════════════════════════════');

    const borrowInput = {
        collateral_satoshis:       COLLATERAL_SATS.toString(),
        old_debt_stroops:          '0',
        secret:                    SECRET.toString(),
        nonce:                     NONCE.toString(),
        new_nonce:                 NEW_NONCE.toString(),
        path_elements:             pathElements.map(String),
        path_indices:              pathIndices.map(String),
        old_root:                  newRoot.toString(),
        delta_stroops:             BORROW_AMOUNT.toString(),
        is_borrow:                 '1',
        btc_price_stroops_per_btc: PRICE_STROOPS.toString(),
        min_ratio_bp:              MIN_RATIO_BP.toString(),
    };

    console.log('Generating borrow ZK proof…');
    const { proof: borProof, publicSignals: borSignals } = await groth16Prove('borrow_repay', borrowInput);
    console.log(`✓ borrow proof generated`);
    console.log(`  new_root:        ${borSignals[0]}`);
    console.log(`  old_nullifier:   ${borSignals[1]}`);
    console.log(`  new_commitment:  ${borSignals[2]}`);
    console.log(`  delta_stroops:   ${borSignals[4]}`);

    const rootAfterBorrow = BigInt(borSignals[0]);
    const newCommitmentAfterBorrow = BigInt(borSignals[2]);

    // ── Step 8: Borrow ───────────────────────────────────────────────────────

    const borResult = await invoke(ctId, 'borrow', [
        addressToScVal(keypair.publicKey()),
        proofToScVal(borProof),
        signalsToScVal(borSignals),
    ]);
    console.log(`✓ borrow ${BORROW_AMOUNT} stroops (${Number(BORROW_AMOUNT) / 1e7} XLM) — tx ${borResult.hash}`);
    console.log(`  https://stellar.expert/explorer/testnet/tx/${borResult.hash}`);

    // ── Step 9: Generate repay ZK proof ──────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('STEP 6: Full repayment — generate ZK proof');
    console.log('══════════════════════════════════════════════════════════════');

    // Build tree for updated state (new commitment after borrow at index 0)
    const { root: rootAfterBorrowComputed, pathElements: repayPath, pathIndices: repayIdx }
        = await buildPoseidonTree(poseidon, newCommitmentAfterBorrow);

    // Sanity check: roots must match
    if (rootAfterBorrowComputed !== rootAfterBorrow) {
        throw new Error(`Root mismatch after borrow: circuit=${rootAfterBorrow.toString(16)}, computed=${rootAfterBorrowComputed.toString(16)}`);
    }
    console.log('✓ root after borrow verified');

    // For repay: delta_stroops = p - BORROW_AMOUNT (field negation)
    const repayDelta = (FIELD_PRIME - BORROW_AMOUNT) % FIELD_PRIME;

    const repayInput = {
        collateral_satoshis:       COLLATERAL_SATS.toString(),
        old_debt_stroops:          BORROW_AMOUNT.toString(),
        secret:                    SECRET.toString(),
        nonce:                     NEW_NONCE.toString(),    // nonce was updated on borrow
        new_nonce:                 REPAY_NONCE.toString(),
        path_elements:             repayPath.map(String),
        path_indices:              repayIdx.map(String),
        old_root:                  rootAfterBorrow.toString(),
        delta_stroops:             repayDelta.toString(),
        is_borrow:                 '0',
        btc_price_stroops_per_btc: PRICE_STROOPS.toString(),
        min_ratio_bp:              MIN_RATIO_BP.toString(),
    };

    console.log('Generating repay ZK proof…');
    const { proof: repProof, publicSignals: repSignals } = await groth16Prove('borrow_repay', repayInput);
    console.log(`✓ repay proof generated`);
    console.log(`  new_root:       ${repSignals[0]}`);
    console.log(`  delta_stroops:  ${repSignals[4]} (field neg of ${BORROW_AMOUNT})`);

    // ── Step 10: Repay ───────────────────────────────────────────────────────

    const repResult = await invoke(ctId, 'repay', [
        addressToScVal(keypair.publicKey()),
        proofToScVal(repProof),
        signalsToScVal(repSignals),
    ]);
    console.log(`✓ repay ${BORROW_AMOUNT} stroops — tx ${repResult.hash}`);
    console.log(`  https://stellar.expert/explorer/testnet/tx/${repResult.hash}`);

    // ── Final state ───────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('✅ END-TO-END ZK FLOW COMPLETE');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`\ncommitment-tree (e2e test): ${ctId}`);
    console.log('\nTransaction log:');
    console.log(`  initialize:          tx ${initResult.hash}`);
    console.log(`  supply_usdc:         tx ${supplyResult.hash}`);
    console.log(`  deposit (ZK):        tx ${depResult.hash}`);
    console.log(`  insert_commitment:   tx ${insertResult.hash}`);
    console.log(`  borrow (ZK):         tx ${borResult.hash}`);
    console.log(`  repay (ZK):          tx ${repResult.hash}`);
    console.log('\nAll ZK proofs verified on-chain by the zk-verifier contract. ✅');
}

main().catch(e => { console.error('\n❌', e.message || e); process.exit(1); });
