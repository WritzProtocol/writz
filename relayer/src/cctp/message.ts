/**
 * Circle CCTP V2 message decoding, and the one route the relay pays gas for:
 * a USDC burn on Stellar (domain 27) minted on Base Sepolia (domain 6).
 *
 * The relay key pays for whatever `receiveMessage` it is handed, and Circle
 * signs messages for every CCTP chain and every handler. Decoding the header
 * here, before anything is sent, is what keeps that key from paying for a
 * transfer between two other chains, a message to some other recipient
 * contract, or one only a named caller may complete (which would revert, at
 * the relay's expense, after the simulation).
 *
 * Layouts, from Circle's MessageV2 and BurnMessageV2 (all integers big-endian):
 *
 *   header  version u32 | sourceDomain u32 | destinationDomain u32 | nonce b32
 *           | sender b32 | recipient b32 | destinationCaller b32
 *           | minFinalityThreshold u32 | finalityThresholdExecuted u32 | body
 *   body    version u32 | burnToken b32 | mintRecipient b32 | amount u256
 *           | messageSender b32 | maxFee u256 | feeExecuted u256
 *           | expirationBlock u256 | hookData
 */

/** Circle's domain for Stellar. */
export const STELLAR_DOMAIN = 27;
/** Circle's domain for Base (and Base Sepolia). */
export const BASE_DOMAIN = 6;
/** MessageV2 and BurnMessageV2 both carry version 1 (V1 messages carried 0). */
export const MESSAGE_VERSION = 1;
export const BURN_MESSAGE_VERSION = 1;

/** MessageTransmitterV2 on Base Sepolia: where `receiveMessage` is called. */
export const BASE_SEPOLIA_MESSAGE_TRANSMITTER = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
/** TokenMessengerV2 on Base Sepolia: the only message recipient the relay accepts (it mints USDC). */
export const BASE_SEPOLIA_TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
export const BASE_SEPOLIA_CHAIN_ID = 84532;

const HEADER_BYTES = 148;
const BODY_BYTES = 228;

export interface CctpBurnMessage {
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  /** 0x-prefixed bytes32; the key `usedNonces` and `MessageReceived` are indexed by. */
  nonce: string;
  sender: string;
  recipient: string;
  destinationCaller: string;
  minFinalityThreshold: number;
  finalityThresholdExecuted: number;
  body: {
    version: number;
    burnToken: string;
    mintRecipient: string;
    /** USDC base units (6 decimals), as a decimal string. */
    amount: string;
    messageSender: string;
    maxFee: string;
    feeExecuted: string;
    expirationBlock: string;
    hookData: string;
  };
}

/** Why a message is not one the relay will complete. The text reaches the app as a failure reason. */
export class MessageRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageRefusedError";
  }
}

function hexToBytes(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new MessageRefusedError("the transfer message is not valid hex");
  }
  return Buffer.from(clean, "hex");
}

const b32 = (buf: Buffer, at: number) => `0x${buf.subarray(at, at + 32).toString("hex")}`;
const u256 = (buf: Buffer, at: number) => BigInt(b32(buf, at)).toString();

/** Decodes a V2 burn message. Throws `MessageRefusedError` when it is too short to be one. */
export function decodeBurnMessage(messageHex: string): CctpBurnMessage {
  const m = hexToBytes(messageHex);
  if (m.length < HEADER_BYTES + BODY_BYTES) {
    throw new MessageRefusedError("the transfer message is too short to be a CCTP V2 burn");
  }
  const body = m.subarray(HEADER_BYTES);
  return {
    version: m.readUInt32BE(0),
    sourceDomain: m.readUInt32BE(4),
    destinationDomain: m.readUInt32BE(8),
    nonce: b32(m, 12),
    sender: b32(m, 44),
    recipient: b32(m, 76),
    destinationCaller: b32(m, 108),
    minFinalityThreshold: m.readUInt32BE(140),
    finalityThresholdExecuted: m.readUInt32BE(144),
    body: {
      version: body.readUInt32BE(0),
      burnToken: b32(body, 4),
      mintRecipient: b32(body, 36),
      amount: u256(body, 68),
      messageSender: b32(body, 100),
      maxFee: u256(body, 132),
      feeExecuted: u256(body, 164),
      expirationBlock: u256(body, 196),
      hookData: `0x${body.subarray(BODY_BYTES).toString("hex")}`,
    },
  };
}

/** An EVM address left-padded to 32 bytes, as CCTP carries it. */
export const addressToBytes32 = (address: string): string =>
  `0x${"0".repeat(24)}${address.toLowerCase().replace(/^0x/, "")}`;

/** The EVM address in a bytes32, or undefined when the top 12 bytes are not zero. */
export function bytes32ToAddress(value: string): string | undefined {
  const hex = value.toLowerCase().replace(/^0x/, "");
  if (hex.length !== 64 || !/^0{24}/.test(hex)) return undefined;
  return `0x${hex.slice(24)}`;
}

const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

export interface RelayableBurn {
  message: CctpBurnMessage;
  /** The Base Sepolia address the USDC is minted to. */
  mintRecipient: string;
}

/**
 * Accepts only a Stellar to Base Sepolia USDC burn that anyone may complete,
 * with no hook: exactly what the app's `deposit_for_burn` produces. Anything
 * else is refused before the relay spends gas on it.
 */
export function assertRelayable(messageHex: string): RelayableBurn {
  const message = decodeBurnMessage(messageHex);
  if (message.version !== MESSAGE_VERSION || message.body.version !== BURN_MESSAGE_VERSION) {
    throw new MessageRefusedError("the transfer is not a CCTP V2 burn");
  }
  if (message.sourceDomain !== STELLAR_DOMAIN) {
    throw new MessageRefusedError("the transfer was not sent from Stellar");
  }
  if (message.destinationDomain !== BASE_DOMAIN) {
    throw new MessageRefusedError("the transfer is not addressed to Base Sepolia");
  }
  if (message.recipient !== addressToBytes32(BASE_SEPOLIA_TOKEN_MESSENGER)) {
    throw new MessageRefusedError("the transfer is not a USDC mint through Circle's TokenMessenger");
  }
  if (message.destinationCaller !== ZERO_BYTES32) {
    throw new MessageRefusedError("the transfer names its own caller on Base Sepolia, so the relay cannot complete it");
  }
  if (message.body.hookData !== "0x") {
    throw new MessageRefusedError("the transfer carries a hook, which the relay does not run");
  }
  const mintRecipient = bytes32ToAddress(message.body.mintRecipient);
  if (!mintRecipient || mintRecipient === `0x${"0".repeat(40)}`) {
    throw new MessageRefusedError("the transfer's recipient is not a Base Sepolia address");
  }
  if (BigInt(message.body.amount) <= 0n) {
    throw new MessageRefusedError("the transfer's amount is zero");
  }
  return { message, mintRecipient };
}
