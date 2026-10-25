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
import { bidInclusionFeeOnly } from "../src/soroban-fee";

const PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = "CCMSOCBVX2S645MQFFXJRHVHRWH2NY62KLOJXNDYFOJRYHIC47EO6ZZK";
const SOURCE = Keypair.random().publicKey();
const INCLUSION_FEE = 100;
// The resource fee publish_release_psbt needed on testnet on 2026-10-25: twice
// this is above the uint32 fee field.
const PUBLISH_RESOURCE_FEE = 2_673_917_892n;
const UINT32_MAX = 4_294_967_295;

/** An AssembledTransaction in the state simulation leaves it: fee = inclusion + resource fee. */
function assembled(resourceFee: bigint): contract.AssembledTransaction<null> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(CONTRACT_ID).toScAddress(),
      key: nativeToScVal("ReleasePsbt", { type: "symbol" }),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const sorobanData = new SorobanDataBuilder().setReadWrite([key]).setResourceFee(resourceFee).build();
  const built = new TransactionBuilder(new Account(SOURCE, "1"), {
    fee: String(INCLUSION_FEE),
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(new Contract(CONTRACT_ID).call("publish_release_psbt"))
    .setSorobanData(sorobanData)
    .setTimeout(300)
    .build();
  return contract.AssembledTransaction.fromJSON(
    {
      contractId: CONTRACT_ID,
      method: "publish_release_psbt",
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

function signer() {
  const seen: string[] = [];
  const signTransaction = async (txXdr: string) => {
    seen.push(txXdr);
    return { signedTxXdr: txXdr, signerAddress: SOURCE };
  };
  return { seen, signTransaction };
}

const signedFee = (txXdr: string) => Number(TransactionBuilder.fromXDR(txXdr, PASSPHRASE).fee);

describe("bidInclusionFeeOnly (relayer)", () => {
  test("without it the SDK overflows the fee on a release-sized resource fee", async () => {
    const { seen, signTransaction } = signer();
    await expect(assembled(PUBLISH_RESOURCE_FEE).sign({ signTransaction })).rejects.toThrow(/maximum uint32 value/);
    expect(seen).toHaveLength(0);
  });

  test("with it the release is signed once, with the inclusion fee on top", async () => {
    const tx = assembled(PUBLISH_RESOURCE_FEE);
    const { seen, signTransaction } = signer();
    bidInclusionFeeOnly(tx);
    await tx.sign({ signTransaction });
    expect(signedFee(seen[0])).toBe(INCLUSION_FEE + Number(PUBLISH_RESOURCE_FEE));
    expect(signedFee(seen[0])).toBeLessThanOrEqual(UINT32_MAX);
  });

  test("a small resource fee is no longer counted twice, and a second call changes nothing", async () => {
    const tx = assembled(5_000_000n);
    bidInclusionFeeOnly(tx);
    bidInclusionFeeOnly(tx);
    const { seen, signTransaction } = signer();
    await tx.sign({ signTransaction });
    expect(signedFee(seen[0])).toBe(INCLUSION_FEE + 5_000_000);
  });
});
