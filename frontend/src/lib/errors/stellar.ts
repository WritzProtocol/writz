import { config } from "@/config";

function assetLabel(assetCode = config.usdc.code): string {
  return assetCode || "asset";
}

export function explainTrustlineError(
  raw: string,
  options?: {
    action?: string;
    assetCode?: string;
  },
): string {
  const code = assetLabel(options?.assetCode);
  const action = options?.action ?? `use ${code}`;

  if (/(TokenErrors\.)?MissingTrustline|op_no_trust/i.test(raw)) {
    return `Your wallet is missing the ${code} trustline required to ${action}. Use "Enable ${code}" first, then retry.`;
  }

  return raw;
}
