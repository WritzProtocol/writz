import { NextRequest, NextResponse } from "next/server";
import {
  buildUnconfiguredSummary,
  createDefindexSdk,
  extractDefindexError,
  extractDefindexStatus,
  extractBalanceSummary,
  extractHealth,
  extractTxHash,
  extractVaultSummary,
  extractXdr,
  getDefindexBaseUrl,
  getDefindexNetwork,
  getDefindexVaultAddress,
  hasDefindexApiKey,
  parseAmountArray,
  parseShares,
  readDefindexNetworkWarning,
  sanitizeDefindexResult,
} from "@/lib/defindex/server";
import type { DefindexSummaryResponse } from "@/lib/defindex/types";

export const runtime = "nodejs";

function networkName(): "TESTNET" | "MAINNET" {
  return process.env.DEFINDEX_NETWORK?.toUpperCase() === "MAINNET"
    ? "MAINNET"
    : "TESTNET";
}

export async function GET(req: NextRequest) {
  if (!hasDefindexApiKey()) {
    return NextResponse.json(buildUnconfiguredSummary());
  }

  const sdk = createDefindexSdk();
  const network = getDefindexNetwork();
  const vaultAddress = getDefindexVaultAddress();
  const address = req.nextUrl.searchParams.get("address");

  const summary: DefindexSummaryResponse = {
    configured: Boolean(vaultAddress),
    network: networkName(),
    baseUrl: getDefindexBaseUrl(),
    health: null,
    factoryAddress: null,
    vault: null,
    balance: null,
    warning: vaultAddress
      ? null
      : "Set NEXT_PUBLIC_DEFINDEX_VAULT_ADDRESS to enable vault actions.",
    error: null,
  };

  try {
    const healthResult = await sdk.healthCheck();
    summary.health = extractHealth(healthResult);
    summary.warning ??= readDefindexNetworkWarning(healthResult);
  } catch (error) {
    summary.error = extractDefindexError(
      error,
      "Failed to reach DeFindex health endpoint",
    );
    return NextResponse.json(summary, { status: extractDefindexStatus(error) });
  }

  try {
    const factory = await sdk.getFactoryAddress(network);
    summary.factoryAddress =
      factory && typeof factory === "object" && "address" in factory
        ? String((factory as { address: unknown }).address)
        : null;
  } catch {
    // Keep the rest of the panel functional even if factory lookup fails.
  }

  if (!vaultAddress) {
    return NextResponse.json(summary);
  }

  const [vaultInfoResult, apyResult, balanceResult] = await Promise.allSettled([
    sdk.getVaultInfo(vaultAddress, network),
    sdk.getVaultAPY(vaultAddress, network),
    address ? sdk.getVaultBalance(vaultAddress, address, network) : Promise.resolve(null),
  ]);

  if (vaultInfoResult.status === "fulfilled") {
    const apyPayload = apyResult.status === "fulfilled" ? apyResult.value : null;
    summary.vault = extractVaultSummary(
      vaultAddress,
      vaultInfoResult.value,
      apyPayload,
    );
  } else {
    summary.error = extractDefindexError(
      vaultInfoResult.reason,
      "Failed to read DeFindex vault info",
    );
  }

  if (balanceResult.status === "fulfilled" && balanceResult.value) {
    summary.balance = extractBalanceSummary(balanceResult.value);
  }

  return NextResponse.json(summary);
}

export async function POST(req: NextRequest) {
  if (!hasDefindexApiKey()) {
    return NextResponse.json(
      { error: "DEFINDEX_API_KEY is not configured" },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  if (action !== "deposit" && action !== "withdraw" && action !== "send") {
    return NextResponse.json(
      { error: "action must be deposit, withdraw, or send" },
      { status: 400 },
    );
  }

  const sdk = createDefindexSdk();
  const network = getDefindexNetwork();
  const vaultAddress = getDefindexVaultAddress();

  try {
    if (action === "deposit") {
      const caller = typeof body.caller === "string" ? body.caller : null;
      if (!caller) {
        return NextResponse.json({ error: "caller is required" }, { status: 400 });
      }
      if (!vaultAddress) {
        return NextResponse.json(
          { error: "NEXT_PUBLIC_DEFINDEX_VAULT_ADDRESS is not configured" },
          { status: 503 },
        );
      }

      const response = await sdk.depositToVault(
        vaultAddress,
        {
          amounts: parseAmountArray(body.amounts),
          caller,
          invest: body.invest === false ? false : true,
          slippageBps:
            typeof body.slippageBps === "number" ? body.slippageBps : 100,
        },
        network,
      );

      return NextResponse.json({
        xdr: extractXdr(response),
        hash: null,
        result: sanitizeDefindexResult(response),
      });
    }

    if (action === "withdraw") {
      const caller = typeof body.caller === "string" ? body.caller : null;
      if (!caller) {
        return NextResponse.json({ error: "caller is required" }, { status: 400 });
      }
      if (!vaultAddress) {
        return NextResponse.json(
          { error: "NEXT_PUBLIC_DEFINDEX_VAULT_ADDRESS is not configured" },
          { status: 503 },
        );
      }

      const response =
        body.shares !== undefined
          ? await sdk.withdrawShares(
              vaultAddress,
              {
                shares: parseShares(body.shares),
                caller,
                slippageBps:
                  typeof body.slippageBps === "number" ? body.slippageBps : 100,
              },
              network,
            )
          : await sdk.withdrawFromVault(
              vaultAddress,
              {
                amounts: parseAmountArray(body.amounts),
                caller,
                slippageBps:
                  typeof body.slippageBps === "number" ? body.slippageBps : 100,
              },
              network,
            );

      return NextResponse.json({
        xdr: extractXdr(response),
        hash: null,
        result: sanitizeDefindexResult(response),
      });
    }

    const signedXdr =
      typeof body.signedXdr === "string" ? body.signedXdr.trim() : "";
    if (!signedXdr) {
      return NextResponse.json(
        { error: "signedXdr is required" },
        { status: 400 },
      );
    }

    const response = await sdk.sendTransaction(signedXdr, network);
    return NextResponse.json({
      xdr: null,
      hash: extractTxHash(response),
      result: sanitizeDefindexResult(response),
    });
  } catch (error) {
    const message = extractDefindexError(error, "DeFindex request failed");
    return NextResponse.json(
      { error: message },
      { status: extractDefindexStatus(error) },
    );
  }
}
