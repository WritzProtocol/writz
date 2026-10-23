"use client";

import { useSyncExternalStore } from "react";
import type { AuthState, WalletProvisioning } from "@pollar/core";
import { pollarClient } from "./pollar";

export interface PollarSession {
  /** False until a remembered session has been restored, or found absent. */
  ready: boolean;
  auth: AuthState;
  /** The custodial Stellar wallet's G-address, once the user is signed in. */
  address: string | null;
  provisioning: WalletProvisioning | null;
}

const IDLE: PollarSession = { ready: false, auth: { step: "idle" }, address: null, provisioning: null };

// getAuthState() returns a fresh clone on every call, so the snapshot is
// cached here from the change callbacks to keep useSyncExternalStore stable.
let snapshot = IDLE;
let wired = false;
const listeners = new Set<() => void>();

function update(patch: Partial<PollarSession>) {
  const client = pollarClient();
  const wallet = client?.getWallet() ?? null;
  const next = { ...snapshot, ...patch };
  next.address = next.auth.step === "authenticated" && wallet?.custody === "internal" ? wallet.address : null;
  next.provisioning = next.address ? (patch.provisioning ?? wallet?.provisioning ?? next.provisioning) : null;
  snapshot = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  const client = pollarClient();
  if (client && !wired) {
    wired = true;
    client.onAuthStateChange((auth) => update({ auth }));
    client.onWalletStateChange((provisioning) => update({ provisioning }));
    void client.ready().finally(() => update({ ready: true }));
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Pollar's auth and wallet state, or a permanently idle session when Pollar is not configured. */
export function usePollarSession(): PollarSession {
  return useSyncExternalStore(subscribe, () => snapshot, () => IDLE);
}
