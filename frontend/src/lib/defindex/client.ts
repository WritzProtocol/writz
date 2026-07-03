import type {
  DefindexActionResponse,
  DefindexSummaryResponse,
} from "./types";

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body as T;
}

export async function getDefindexSummary(
  address?: string,
): Promise<DefindexSummaryResponse> {
  const query = address ? `?address=${encodeURIComponent(address)}` : "";
  const response = await fetch(`/api/defindex${query}`, {
    cache: "no-store",
  });
  return readJson<DefindexSummaryResponse>(response);
}

export async function buildDefindexDeposit(params: {
  caller: string;
  amounts: string[];
  invest?: boolean;
  slippageBps?: number;
}): Promise<DefindexActionResponse> {
  const response = await fetch("/api/defindex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "deposit",
      caller: params.caller,
      amounts: params.amounts,
      invest: params.invest,
      slippageBps: params.slippageBps,
    }),
  });
  return readJson<DefindexActionResponse>(response);
}

export async function buildDefindexWithdraw(params: {
  caller: string;
  amounts?: string[];
  shares?: string;
  slippageBps?: number;
}): Promise<DefindexActionResponse> {
  const response = await fetch("/api/defindex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "withdraw",
      caller: params.caller,
      amounts: params.amounts,
      shares: params.shares,
      slippageBps: params.slippageBps,
    }),
  });
  return readJson<DefindexActionResponse>(response);
}

export async function sendDefindexTransaction(
  signedXdr: string,
): Promise<DefindexActionResponse> {
  const response = await fetch("/api/defindex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "send",
      signedXdr,
    }),
  });
  return readJson<DefindexActionResponse>(response);
}
