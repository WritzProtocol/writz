import { describe, expect, test } from "bun:test";
import {
  Account,
  Address,
  Contract,
  contract,
  Keypair,
  Networks,
  nativeToScVal,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { bidInclusionFeeOnly } from "./stellarTx";

const PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = "CCMSOCBVX2S645MQFFXJRHVHRWH2NY62KLOJXNDYFOJRYHIC47EO6ZZK";
const SOURCE = Keypair.random().publicKey();
const INCLUSION_FEE = 100;
// The resource fee simulation declared for a writz-lend deposit on testnet on
// 2026-10-25 (transaction 6c0e3a1a...): twice this is above the uint32 fee field.
const DEPOSIT_RESOURCE_FEE = 3_519_174_187n;
const UINT32_MAX = 4_294_967_295;

/** An AssembledTransaction in the state `simulate()` leaves it: fee = inclusion + resource fee. */
function assembled(resourceFee: bigint): contract.AssembledTransaction<null> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(CONTRACT_ID).toScAddress(),
      key: nativeToScVal("Position", { type: "symbol" }),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const sorobanData = new SorobanDataBuilder().setReadWrite([key]).setResourceFee(resourceFee).build();
  const built = new TransactionBuilder(new Account(SOURCE, "1"), {
    fee: String(INCLUSION_FEE),
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(new Contract(CONTRACT_ID).call("deposit"))
    .setSorobanData(sorobanData)
    .setTimeout(300)
    .build();
  expect(Number(built.fee)).toBe(INCLUSION_FEE + Number(resourceFee));
  return contract.AssembledTransaction.fromJSON(
    {
      contractId: CONTRACT_ID,
      method: "deposit",
      networkPassphrase: PASSPHRASE,
      rpcUrl: "https://rpc.invalid",
      publicKey: SOURCE,
      parseResultXdr: () => null,
    },
    {
      tx: built.toXDR(),
      simulationResult: { auth: [], retval: xdr.ScVal.scvVoid().toXDR("base64") },
      simulationTransactionData: sorobanData.toXDR("base64"),
    },
  );
}

/** Captures the transaction the wallet is asked to sign and returns it unchanged. */
function wallet() {
  const seen: string[] = [];
  const signTransaction = async (txXdr: string) => {
    seen.push(txXdr);
    return { signedTxXdr: txXdr, signerAddress: SOURCE };
  };
  return { seen, signTransaction };
}

const signedFee = (txXdr: string) => Number(TransactionBuilder.fromXDR(txXdr, PASSPHRASE).fee);

describe("bidInclusionFeeOnly", () => {
  test("the SDK alone overflows the fee on a deposit-sized resource fee", async () => {
    const tx = assembled(DEPOSIT_RESOURCE_FEE);
    const { seen, signTransaction } = wallet();
    await expect(tx.sign({ signTransaction })).rejects.toThrow(/maximum uint32 value/);
    expect(seen).toHaveLength(0);
  });

  test("a deposit-sized resource fee is signed once, with the inclusion fee on top", async () => {
    const tx = assembled(DEPOSIT_RESOURCE_FEE);
    const { seen, signTransaction } = wallet();
    bidInclusionFeeOnly(tx);
    await tx.sign({ signTransaction });
    expect(seen).toHaveLength(1);
    expect(signedFee(seen[0])).toBe(INCLUSION_FEE + Number(DEPOSIT_RESOURCE_FEE));
    expect(signedFee(seen[0])).toBeLessThanOrEqual(UINT32_MAX);
    const signed = TransactionBuilder.fromXDR(seen[0], PASSPHRASE);
    const data = signed.toEnvelope().v1().tx().ext().value() as xdr.SorobanTransactionData;
    expect(data.resourceFee().toBigInt()).toBe(DEPOSIT_RESOURCE_FEE);
  });

  test("a small resource fee is no longer counted twice", async () => {
    const resourceFee = 5_000_000n;
    const unfixed = wallet();
    await assembled(resourceFee).sign({ signTransaction: unfixed.signTransaction });
    expect(signedFee(unfixed.seen[0])).toBe(INCLUSION_FEE + 2 * Number(resourceFee));

    const fixed = wallet();
    const tx = assembled(resourceFee);
    bidInclusionFeeOnly(tx);
    await tx.sign({ signTransaction: fixed.signTransaction });
    expect(signedFee(fixed.seen[0])).toBe(INCLUSION_FEE + Number(resourceFee));
  });

  test("is idempotent, so signing again after a cancelled prompt bids the same fee", async () => {
    const resourceFee = 50n;
    const tx = assembled(resourceFee);
    bidInclusionFeeOnly(tx);
    bidInclusionFeeOnly(tx);
    const { seen, signTransaction } = wallet();
    await tx.sign({ signTransaction });
    expect(signedFee(seen[0])).toBe(INCLUSION_FEE + Number(resourceFee));
  });
});
