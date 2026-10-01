import { CommitmentTreeError } from "@/lib/contracts/generated";
import { config } from "@/config";

export type ContractName = "commitment-tree" | "bitcoin-spv";

type ErrorTable = Readonly<Record<number, { message: string }>>;

/**
 * The deployed bitcoin-spv contract's `SPVError`, read with
 * `stellar contract info interface --network testnet --id <NEXT_PUBLIC_BITCOIN_SPV_ID>`.
 * The app has no generated binding for it, and `deposit` on the commitment
 * tree passes these codes through unchanged.
 */
export const BitcoinSpvError: ErrorTable = {
  1: { message: "NoHeaders" },
  2: { message: "InsufficientConfirmations" },
  3: { message: "ZeroMinConfirmations" },
  4: { message: "HeaderChainBroken" },
  5: { message: "MerkleProofInvalid" },
  6: { message: "InvalidHeaderSlice" },
  7: { message: "EmptyTransaction" },
  8: { message: "InsufficientProofOfWork" },
  9: { message: "InvalidDifficultyBits" },
  10: { message: "NotInitialized" },
  11: { message: "AlreadyInitialized" },
  12: { message: "Unauthorized" },
  13: { message: "CheckpointNotSet" },
  14: { message: "DifficultyBelowCheckpointFloor" },
};

// The deployed commitment tree also has #16 Paused; the generated binding stops at 15.
const DeployedCommitmentTreeError: ErrorTable = { ...CommitmentTreeError, 16: { message: "Paused" } };

const TABLES: Record<ContractName, ErrorTable> = {
  "commitment-tree": DeployedCommitmentTreeError,
  "bitcoin-spv": BitcoinSpvError,
};

export interface ContractFailure {
  contract: ContractName;
  code: number;
  /** The variant name, when the deployed contract's table has this code. */
  variant?: string;
}

export interface ContractIds {
  commitmentTree: string;
  bitcoinSpv: string;
}

const CODE = /Error\(Contract,\s*#(\d+)\)/;
const ERROR_EVENT = /contract:\s*(C[A-Z2-7]{55}),\s*topics:\[error,\s*Error\(Contract,\s*#(\d+)\)\]/g;

function failure(contract: ContractName, code: number): ContractFailure {
  return { contract, code, variant: TABLES[contract][code]?.message };
}

/**
 * Turns `HostError: Error(Contract, #N)` into the contract and variant that
 * raised it. Contract failures carry only the number, and the same number
 * means different things in different contracts, so the contract comes from
 * the diagnostic event log when one is present. The log is newest first and
 * a cross-contract failure is escalated up the stack, so the last error event
 * is the contract that raised it.
 */
export function resolveContractError(
  message: string,
  ids: ContractIds = config.contracts,
): ContractFailure | null {
  const events = [...message.matchAll(ERROR_EVENT)];
  if (events.length > 0) {
    const [, id, code] = events[events.length - 1];
    if (id === ids.bitcoinSpv) return failure("bitcoin-spv", Number(code));
    if (id === ids.commitmentTree) return failure("commitment-tree", Number(code));
    return null;
  }
  const bare = CODE.exec(message);
  return bare ? failure("commitment-tree", Number(bare[1])) : null;
}
