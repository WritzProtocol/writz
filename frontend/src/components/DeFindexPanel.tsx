"use client";

import { useCallback, useEffect, useState } from "react";
import { config } from "@/config";
import { explainTrustlineError } from "@/lib/errors/stellar";
import { stellarTxUrl } from "@/lib/explorer";
import {
  buildDefindexDeposit,
  buildDefindexWithdraw,
  getDefindexSummary,
  sendDefindexTransaction,
} from "@/lib/defindex/client";
import type { DefindexSummaryResponse } from "@/lib/defindex/types";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { TxLink } from "./TxLink";

function parseFixed(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) return null;
  const paddedFraction = fraction.padEnd(decimals, "0");
  return BigInt(`${whole}${paddedFraction}`);
}

function formatFixed(value: string | null, decimals: number): string {
  if (!value || !/^-?\d+$/.test(value)) return "—";
  const amount = BigInt(value);
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toLocaleString("en-US");
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

function explainDefindexActionError(
  raw: string,
  params: { action: "deposit" | "withdraw"; assetSymbol: string },
): string {
  if (/(TokenErrors\.)?MissingTrustline|op_no_trust/i.test(raw)) {
    return `The DeFindex vault rejected this ${params.action} because your wallet does not have the exact ${params.assetSymbol} trustline the vault expects. If you already enabled Writz USDC, this vault may be using a different issuer or the issuer may still need to authorize your trustline.`;
  }

  return explainTrustlineError(raw, {
    action:
      params.action === "deposit"
        ? `deposit ${params.assetSymbol} into the DeFindex vault`
        : `withdraw ${params.assetSymbol} from the DeFindex vault`,
    assetCode: params.assetSymbol,
  });
}

export function DeFindexPanel() {
  const { address, signTransaction } = useWallet();
  const [summary, setSummary] = useState<DefindexSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await getDefindexSummary(address ?? undefined);
      setSummary(next);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getDefindexSummary(address ?? undefined);
        if (!cancelled) {
          setSummary(next);
          setError(null);
          setLoading(false);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  const assetSymbol = config.defindex.assetSymbol;
  const assetDecimals = config.defindex.assetDecimals;
  const singleAssetVault =
    summary?.vault !== null && summary?.vault !== undefined
      ? summary.vault.assetCount === 1
      : true;

  async function handleSubmit() {
    setMessage(null);
    setTxHash(null);

    if (!address) {
      setStatus("error");
      setMessage("Connect your Stellar wallet first.");
      return;
    }

    if (!summary?.configured || !summary.vault) {
      setStatus("error");
      setMessage("Configure the DeFindex API key and vault address first.");
      return;
    }

    if (!singleAssetVault) {
      setStatus("error");
      setMessage("This DeFindex panel currently supports single-asset vaults only.");
      return;
    }

    const parsed = parseFixed(amount, assetDecimals);
    if (parsed === null || parsed <= 0n) {
      setStatus("error");
      setMessage(`Enter a valid ${assetSymbol} amount.`);
      return;
    }

    setStatus("working");
    try {
      const built =
        mode === "deposit"
          ? await buildDefindexDeposit({
              caller: address,
              amounts: [parsed.toString()],
              invest: true,
              slippageBps: 100,
            })
          : await buildDefindexWithdraw({
              caller: address,
              amounts: [parsed.toString()],
              slippageBps: 100,
            });

      if (!built.xdr) {
        throw new Error("DeFindex did not return an XDR to sign.");
      }

      const { signedTxXdr } = await signTransaction(built.xdr);
      const sent = await sendDefindexTransaction(signedTxXdr);

      setStatus("done");
      setMessage(
        mode === "deposit"
          ? "Deposited into the DeFindex vault."
          : "Withdrew from the DeFindex vault.",
      );
      setTxHash(sent.hash);
      setAmount("");
      await reload();
    } catch (submitError) {
      setStatus("error");
      setMessage(
        explainDefindexActionError(
          submitError instanceof Error ? submitError.message : String(submitError),
          {
            action: mode,
            assetSymbol,
          },
        ),
      );
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h3 className="font-serif text-xl text-head">DeFindex vault</h3>
          <p className="mt-1 text-sm text-muted">
            Optional vault routing for idle {assetSymbol} alongside Writz pool lending.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void reload();
          }}
          disabled={loading}
          className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted transition-colors hover:text-head disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-crit/40 bg-crit/10 p-4 text-sm text-crit">
          {error}
        </div>
      ) : null}

      {summary?.error ? (
        <div className="mt-4 rounded-lg border border-crit/40 bg-crit/10 p-4 text-sm text-crit">
          {summary.error}
        </div>
      ) : null}

      {!summary?.configured ? (
        <div className="mt-4 rounded-lg border border-amber/40 bg-amber/5 p-4 text-sm text-body">
          <p className="font-medium text-head">DeFindex is not configured yet.</p>
          <p className="mt-1 text-muted">
            Add `DEFINDEX_API_KEY` and `NEXT_PUBLIC_DEFINDEX_VAULT_ADDRESS` in
            `frontend/.env.local` to enable the vault panel.
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Metric label="API health">
          {summary?.health?.reachable ? "Reachable" : "—"}
        </Metric>
        <Metric label="Network">{summary?.network ?? "TESTNET"}</Metric>
        <Metric label="Vault">
          {summary?.vault?.name
            ? `${summary.vault.name}${summary.vault.symbol ? ` (${summary.vault.symbol})` : ""}`
            : summary?.vault?.address ?? "—"}
        </Metric>
        <Metric label="Factory">{summary?.factoryAddress ?? "—"}</Metric>
        <Metric label={`Vault assets · ${assetSymbol}`}>
          {summary?.vault ? formatFixed(summary.vault.totalAssets, assetDecimals) : "—"}
        </Metric>
        <Metric label="Vault APY">{formatPercent(summary?.vault?.apyPercent ?? null)}</Metric>
        <Metric label="Your vault shares">
          {summary?.balance?.dfTokens ?? "—"}
        </Metric>
        <Metric label="API URL">{summary?.baseUrl ?? "—"}</Metric>
      </div>

      {summary?.warning ? (
        <p className="mt-4 text-xs text-muted">{summary.warning}</p>
      ) : null}

      {!singleAssetVault ? (
        <p className="mt-4 text-xs text-muted">
          This panel is wired for single-asset DeFindex vaults. The configured vault
          reports {summary?.vault?.assetCount ?? 0} assets, so actions are currently disabled.
        </p>
      ) : null}

      <div className="mt-5 border-t border-line pt-4">
        <div
          role="tablist"
          aria-label="Choose DeFindex action"
          className="inline-flex rounded-full border border-line bg-surface-2 p-1"
        >
          <ActionButton
            active={mode === "deposit"}
            onClick={() => setMode("deposit")}
          >
            Deposit
          </ActionButton>
          <ActionButton
            active={mode === "withdraw"}
            onClick={() => setMode("withdraw")}
          >
            Withdraw
          </ActionButton>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder={`${assetSymbol} amount`}
              disabled={status === "working" || !summary?.configured || !singleAssetVault}
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={status === "working" || !summary?.configured || !singleAssetVault}
              className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                mode === "deposit"
                  ? "bg-amber text-[#1a1206] hover:bg-[#eeb459]"
                  : "border border-line-2 text-head hover:border-amber"
              }`}
            >
              {status === "working"
                ? mode === "deposit"
                  ? "Depositing…"
                  : "Withdrawing…"
                : mode === "deposit"
                  ? "Deposit"
                  : "Withdraw"}
            </button>
          </div>
          <p className="text-xs text-muted">
            Uses your existing wallet to sign the DeFindex-built XDR. Amounts are
            converted using {assetDecimals} decimals for {assetSymbol}.
          </p>
          {message ? (
            <p className={`break-all text-xs ${status === "error" ? "text-crit" : "text-ok"}`}>
              {message} {txHash ? <TxLink url={stellarTxUrl(txHash)} hash={txHash} /> : null}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
      <p className="mt-2 break-all font-mono text-sm text-head">{children}</p>
    </div>
  );
}

function ActionButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
        active ? "bg-amber text-[#1a1206]" : "text-muted hover:text-head"
      }`}
    >
      {children}
    </button>
  );
}
