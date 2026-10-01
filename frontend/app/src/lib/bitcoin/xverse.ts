import { RpcErrorCode } from "sats-connect";
import { asRejection, errorMessage, SignatureRejectedError } from "@/lib/wallet/rejection";

/** Xverse failed for a reason other than the user declining. */
export class XverseError extends Error {
  constructor(readonly detail: string) {
    super(`XverseError: ${detail}`);
    this.name = "XverseError";
  }
}

type XverseResponse<T> =
  | { status: "success"; result: T }
  | { status: "error"; error: { code: number; message?: string } };

/**
 * Runs an Xverse request. A user rejection becomes `SignatureRejectedError`;
 * any other failure becomes `XverseError`, so the UI never shows raw wallet text.
 */
export async function xverseRequest<T>(call: () => Promise<XverseResponse<T>>): Promise<T> {
  let res: XverseResponse<T>;
  try {
    res = await call();
  } catch (e) {
    throw asRejection(e, "bitcoin", "Xverse") ?? new XverseError(errorMessage(e));
  }
  if (res.status === "error") {
    if (res.error.code === RpcErrorCode.USER_REJECTION) {
      throw new SignatureRejectedError("bitcoin", "Xverse");
    }
    throw new XverseError(res.error.message ?? `code ${res.error.code}`);
  }
  return res.result;
}
