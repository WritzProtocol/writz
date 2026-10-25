"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { config } from "@/config";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { pollarClient } from "@/lib/wallet/pollar";
import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";
import { addressBalance, isConfirmed } from "@/lib/bitcoin/embedded/send";
import { claimSignetCoins, pollarAccessToken, SignetFaucetError } from "@/lib/faucet/claim";
import { runAutoClaim, type ClaimState, type SavedClaim } from "./autoClaim";
import { milestones, reportStep, subscribeMilestones, type FunnelStep, type Milestones } from "./funnel";
import { browserStorage } from "./storage";

export interface Onboarding {
  /** A Pollar sign-in with its Signet test key in use: the guided loop applies. */
  guided: boolean;
  /** Funding of the test key; idle outside the guided loop. */
  claim: ClaimState;
  retryClaim(): void;
  /** Steps this browser saw for the connected Stellar address. */
  milestones: Milestones;
  /** Reports a funnel step for the connected address (fire and forget). */
  report(step: FunnelStep, txid?: string): void;
}

const IDLE: ClaimState = { kind: "idle" };
const NONE: Milestones = {};

const Ctx = createContext<Onboarding | null>(null);

const savedKey = (signetAddress: string) => `writz:signet-claim:${signetAddress}`;

function savedClaim(signetAddress: string): AutoClaimSaved {
  return {
    get() {
      try {
        const raw = browserStorage()?.getItem(savedKey(signetAddress));
        return raw ? (JSON.parse(raw) as SavedClaim) : null;
      } catch {
        return null;
      }
    },
    set(c) {
      try {
        browserStorage()?.setItem(savedKey(signetAddress), JSON.stringify(c));
      } catch {
        // Not kept: a reload asks the faucet again, which answers already_claimed.
      }
    },
  };
}
type AutoClaimSaved = { get(): SavedClaim | null; set(c: SavedClaim): void };

/** Optional Umami custom event, no properties: counts only. */
function track(name: string) {
  try {
    (window as unknown as { umami?: { track(n: string): void } }).umami?.track(name);
  } catch {
    // Analytics never breaks a flow.
  }
}

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const w = useWallet();
  const b = useBitcoinWallet();
  const address = w.address;
  const social = w.walletBackend === "pollar";
  const channel = social ? "social" : "wallet";
  const embedded = b.embedded?.active ? b.embedded : null;
  const guided = Boolean(social && address && embedded);

  const report = useCallback(
    (step: FunnelStep, txid?: string) => {
      if (!address) return;
      const storage = browserStorage();
      if (!milestones(address, storage)[step]) track(`onboarding_${step}`);
      void reportStep(step, { stellarAddress: address, channel, ...(txid ? { txid } : {}) }, {
        relayerUrl: config.services.relayerUrl,
        storage,
      });
    },
    [address, channel],
  );

  // ── Sign-in: once a Pollar session has its Stellar wallet ──
  useEffect(() => {
    if (social && address) report("sign_in");
  }, [social, address, report]);

  // ── Instant funding of the test key ──
  const [claim, setClaim] = useState<{ key: string; state: ClaimState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef<string | null>(null);
  const signMessage = b.signMessage;
  const signetAddress = guided ? embedded!.address : null;
  const signetPubkey = guided ? embedded!.pubkey : null;
  const runKey = signetAddress && address ? `${address}:${signetAddress}:${attempt}` : null;

  useEffect(() => {
    if (!runKey || !signetAddress || !signetPubkey || !address || started.current === runKey) return;
    started.current = runKey;
    const controller = new AbortController();
    const io = { apiUrl: config.bitcoin.apiUrl };
    void runAutoClaim(
      {
        balance: () => addressBalance(signetAddress, io),
        claim: async () => {
          const client = pollarClient();
          const token = client ? pollarAccessToken(client) : null;
          if (!token) throw new SignetFaucetError("login_expired", "Sign in again to get test BTC.", 401);
          return claimSignetCoins({
            relayerUrl: config.services.relayerUrl,
            accessToken: token,
            stellarAddress: address,
            signetAddress,
            signetPubkey,
            signMessage,
          });
        },
        confirmed: (txid) => isConfirmed(txid, io),
        saved: savedClaim(signetAddress),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      },
      (state) => {
        setClaim({ key: runKey, state });
        if (state.kind === "sent" || state.kind === "failed") track(`onboarding_faucet_${state.kind === "sent" ? "paid" : state.failure.code}`);
      },
      controller.signal,
    );
    return () => {
      controller.abort();
      started.current = null;
    };
    // signMessage changes identity with the active key; the run is keyed by address and attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  const ms = useSyncExternalStore(
    subscribeMilestones,
    () => (address ? milestones(address, browserStorage()) : NONE),
    () => NONE,
  );

  const value = useMemo<Onboarding>(
    () => ({
      guided,
      claim: guided && claim && runKey && claim.key === runKey ? claim.state : guided ? { kind: "checking" } : IDLE,
      retryClaim: () => setAttempt((n) => n + 1),
      milestones: ms,
      report,
    }),
    [guided, claim, runKey, ms, report],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const OUTSIDE: Onboarding = { guided: false, claim: IDLE, retryClaim: () => {}, milestones: NONE, report: () => {} };

/** The onboarding state, or an inert one outside the provider (mock harness, tests). */
export function useOnboarding(): Onboarding {
  return useContext(Ctx) ?? OUTSIDE;
}
