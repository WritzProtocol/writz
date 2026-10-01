"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Horizon, NotFoundError } from "@stellar/stellar-sdk";
import { config } from "@/config";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";
import { deriveP2WSH } from "@/lib/bitcoin/address";
import { ensureKit } from "@/lib/wallet/kit";
import { networkName } from "@/lib/wallet/precheck";
import { useFlow, useTxLockState } from "@/lib/flow/useFlow";
import { isInFlight } from "@/lib/flow/engine";
import { depositLockName, locks } from "@/lib/flow/lock";
import { pendingDeposits } from "@/lib/flow/pendingDeposit";
import {
  depositDeps,
  finishDeposit,
  registerDeposit,
  startDepositBySending,
  startDepositFromTxid,
  trackDeposit,
} from "@/lib/flows/deposit";
import { recoverPositions } from "@/lib/flows/recover";
import { positionsSnapshot, type Position } from "@/lib/position";
import { esploraReads } from "@/lib/status/client";
import { usePositionStatus, useRefreshStatus } from "@/lib/status/provider";
import type { LocalInputs } from "@/lib/status/types";
import {
  btcBalanceOf,
  depositStage,
  estimateFeeSats,
  exitDate,
  fundingOf,
  TIMELOCK_MIN_BLOCKS_LEFT,
  type Funding,
} from "@/lib/borrow/journey";
import { confirmedSats, route, useJourneyUi, type BitcoinError, type JourneyModel, type Reading } from "./model";

const ON_TESTNET = config.target !== "mainnet";
const TXID = /^[0-9a-f]{64}$/i;

/** A read tied to the key it was made for, so a stale answer never shows for a new wallet. */
type Keyed<T> = { key: string; value: Reading<T> } | null;
const forKey = <T,>(r: Keyed<T>, key: string | null): Reading<T> | null =>
  key === null ? null : r?.key === key ? r.value : { kind: "checking" };

function kitWalletName(): string | undefined {
  try {
    return ensureKit().selectedModule.productName;
  } catch {
    return undefined;
  }
}

async function loadFunding(address: string): Promise<Funding> {
  try {
    return fundingOf(await new Horizon.Server(config.horizonUrl).loadAccount(address));
  } catch (e) {
    if (e instanceof NotFoundError) return fundingOf(null);
    throw e;
  }
}

function bitcoinError(message: string | null): BitcoinError | null {
  if (!message) return null;
  if (/rejected/i.test(message)) return { kind: "declined" };
  if (/^Switch your Bitcoin wallet/.test(message)) return { kind: "network", message };
  return { kind: "other", raw: message };
}

const esplora = () => esploraReads(config.bitcoin.apiUrl, (url) => fetch(url));

export function useLiveJourney(): JourneyModel {
  const w = useWallet();
  const b = useBitcoinWallet();
  const ui = useJourneyUi();
  const [flow, emit] = useFlow();
  const address = w.address;

  const pending = useSyncExternalStore(
    pendingDeposits.subscribe,
    () => (address ? pendingDeposits.snapshot(address) : null),
    () => null,
  );
  const pendingTxid = pending?.btcTxid ?? null;
  const txLock = useTxLockState(address);

  const [action, setAction] = useState<"send" | "register" | "finish" | "txid" | null>(null);
  const [createdHere, setCreatedHere] = useState<string | null>(null);
  const [doneSats, setDoneSats] = useState<bigint | null>(null);
  const [doneIndex, setDoneIndex] = useState<number | null>(null);
  const [drivenElsewhere, setDrivenElsewhere] = useState(false);
  const [registering, setRegistering] = useState<Position | null>(null);
  const [runKey, setRunKey] = useState(0);

  // ── Status of the deposit in progress ──
  const local = useMemo<LocalInputs | null>(
    () =>
      pending
        ? {
            position: null,
            pendingDeposit: pending,
            proving: flow.phase === "proving",
            insertFailed: flow.phase === "needs_attention" && Boolean(flow.error),
          }
        : null,
    [pending, flow],
  );
  const status = usePositionStatus(local, 15_000);
  const refreshStatus = useRefreshStatus();

  useEffect(() => {
    emit({ type: "reset" });
  }, [address, emit]);

  // One tab drives a pending deposit; the others wait for its lock and take over if that tab closes.
  useEffect(() => {
    if (!address || !pendingTxid) return;
    const controller = new AbortController();
    let release: (() => void) | null = null;

    void (async () => {
      try {
        release = await locks().holdLock(depositLockName(address), { ifAvailable: true });
        if (!release) {
          setDrivenElsewhere(true);
          release = await locks().holdLock(depositLockName(address), { signal: controller.signal });
        }
        if (controller.signal.aborted) return;
        setDrivenElsewhere(false);
        const result = await trackDeposit(address, { emit, signal: controller.signal });
        if (result.status === "registering") {
          setRegistering(result.position);
          emit({ type: "needs_attention", action: "finish_deposit", hash: result.position.stellarTxHash });
        } else if (result.status === "active") {
          setDoneSats(BigInt(result.position.collateralSats));
          setDoneIndex(result.position.index);
          emit({ type: "settled", hash: result.position.stellarTxHash });
        }
      } catch (e) {
        if (!controller.signal.aborted) emit({ type: "failed", error: e });
      }
    })();

    return () => {
      controller.abort();
      release?.();
      setDrivenElsewhere(false);
    };
  }, [address, pendingTxid, runKey, emit]);

  // ── Stellar: network, funding, loans ──
  const [network, setNetwork] = useState<{ key: string; passphrase: string | null; walletName?: string } | null>(null);
  useEffect(() => {
    if (!address || w.walletBackend !== "kit") return;
    let live = true;
    const check = () =>
      ensureKit()
        .getNetwork()
        .then((n) => live && setNetwork({ key: address, passphrase: n.networkPassphrase, walletName: kitWalletName() }))
        .catch(() => live && setNetwork({ key: address, passphrase: null, walletName: kitWalletName() }));
    void check();
    window.addEventListener("focus", check);
    return () => {
      live = false;
      window.removeEventListener("focus", check);
    };
  }, [address, w.walletBackend]);
  const net = network?.key === address ? network : null;
  const wrongNetwork =
    net?.passphrase && net.passphrase !== config.networkPassphrase ? networkName(net.passphrase) : null;
  const walletName = w.walletBackend === "privy" ? "Privy" : (net?.walletName ?? "your wallet");

  const [fundingRead, setFundingRead] = useState<Keyed<Funding>>(null);
  const [fundNonce, setFundNonce] = useState(0);
  useEffect(() => {
    if (!address) return;
    let live = true;
    const key = `${address}:${fundNonce}`;
    loadFunding(address)
      .then((value) => live && setFundingRead({ key, value: { kind: "ok", value } }))
      .catch(() => live && setFundingRead({ key, value: { kind: "failed" } }));
    return () => {
      live = false;
    };
  }, [address, fundNonce]);
  const funding = forKey(fundingRead, address ? `${address}:${fundNonce}` : null) ?? { kind: "checking" as const };
  const [lowAckFor, setLowAckFor] = useState<string | null>(null);
  const [fundBusy, setFundBusy] = useState(false);
  const [fundError, setFundError] = useState<unknown>(null);

  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<unknown>(null);
  const [find, setFind] = useState<{ seed: Uint8Array; state: "finding" | "found" | "failed"; count: number; error?: unknown } | null>(null);
  const [findNonce, setFindNonce] = useState(0);
  useEffect(() => {
    const seed = w.seed;
    if (!address || !seed) return;
    let live = true;
    void (async () => {
      setFind({ seed, state: "finding", count: 0 });
      try {
        await recoverPositions({ owner: address, seed });
        if (live) setFind({ seed, state: "found", count: positionsSnapshot(address).length });
      } catch (error) {
        if (live) setFind({ seed, state: "failed", count: 0, error });
      }
    })();
    return () => {
      live = false;
    };
  }, [address, w.seed, findNonce]);
  const findState = w.seed && find?.seed === w.seed ? find : null;
  const loans = !w.seed ? (signing ? "signing" : "unsigned") : (findState?.state ?? "finding");

  const fundingOk =
    funding.kind === "failed" ||
    (funding.kind === "ok" && (funding.value.kind === "ok" || (funding.value.kind === "low" && lowAckFor === address)));
  const stellarReady = Boolean(address) && !wrongNetwork && fundingOk && loans === "found";

  // ── Bitcoin: balance, lock address ──
  const [balanceRead, setBalanceRead] = useState<Keyed<bigint>>(null);
  const [balanceNonce, setBalanceNonce] = useState(0);
  const btcAddress = b.btcAddress;
  useEffect(() => {
    if (!btcAddress) return;
    let live = true;
    const key = `${btcAddress}:${balanceNonce}`;
    fetch(`${config.bitcoin.apiUrl}/address/${btcAddress}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((a) => live && setBalanceRead({ key, value: { kind: "ok", value: btcBalanceOf(a) } }))
      .catch(() => live && setBalanceRead({ key, value: { kind: "failed" } }));
    return () => {
      live = false;
    };
  }, [btcAddress, balanceNonce]);
  const balance = forKey(balanceRead, btcAddress ? `${btcAddress}:${balanceNonce}` : null);

  const p2wsh = useMemo(() => {
    if (!config.bitcoin.protocolPubkey || !b.btcPubkey) return null;
    try {
      return deriveP2WSH(config.bitcoin.protocolPubkey, b.btcPubkey, config.bitcoin.timelockHeight).address;
    } catch {
      return null;
    }
  }, [b.btcPubkey]);

  const sats = pending ? BigInt(pending.sats) : confirmedSats(ui);
  const bitcoinReady =
    Boolean(btcAddress && p2wsh) &&
    (balance?.kind === "failed" || (balance?.kind === "ok" && sats !== null && balance.value >= sats));

  // ── Chain context: tip height and fee rate ──
  const [chainCtx, setChainCtx] = useState<{ tip: number | null; feeRate: number | null; at: number } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([
      esplora().getBtcTipHeight().catch(() => null),
      fetch(`${config.bitcoin.apiUrl}/fee-estimates`)
        .then((r) => (r.ok ? (r.json() as Promise<Record<string, number>>) : null))
        .then((f) => (f ? (f["6"] ?? f["3"] ?? null) : null))
        .catch(() => null),
    ]).then(([tip, feeRate]) => live && setChainCtx({ tip, feeRate, at: Date.now() }));
    return () => {
      live = false;
    };
  }, []);
  const blocksLeft = chainCtx?.tip != null ? config.bitcoin.timelockHeight - chainCtx.tip : null;

  // ── Actions ──
  const unavailable = !config.bitcoin.protocolPubkey || !config.services.relayerUrl || !config.contracts.commitmentTree;

  const send = useCallback(async () => {
    if (!address || !b.btcPubkey || !p2wsh || !sats || pending) return;
    setAction("send");
    emit({ type: "start" });
    try {
      const pd = await startDepositBySending({
        owner: address,
        p2wsh,
        btcPubkey: b.btcPubkey,
        usedIndices: positionsSnapshot(address).map((p) => p.index),
        emit,
        sats,
        send: b.sendBtc,
      });
      setCreatedHere(pd.btcTxid);
      ui.setAck(false);
    } catch (e) {
      emit({ type: "failed", error: e });
      ui.bumpSlide();
    }
  }, [address, b.btcPubkey, b.sendBtc, p2wsh, sats, pending, emit, ui]);

  const register = useCallback(async () => {
    if (!address || !w.seed || !pending) return;
    setAction("register");
    setDoneSats(BigInt(pending.sats));
    setDoneIndex(pending.positionIndex);
    emit({ type: "start" });
    try {
      await locks().withTxLock(address, () =>
        registerDeposit({ owner: address, seed: w.seed!, signTransaction: w.signTransaction, emit }),
      );
    } catch (e) {
      emit({ type: "failed", error: e });
    }
  }, [address, w.seed, w.signTransaction, pending, emit]);

  const finish = useCallback(async () => {
    if (!address || !w.seed) return;
    const position =
      registering ??
      positionsSnapshot(address).find((p) => p.status === "registering" && p.txid === pendingTxid);
    if (!position) {
      setRunKey((k) => k + 1);
      return;
    }
    setAction("finish");
    setDoneSats(BigInt(position.collateralSats));
    setDoneIndex(position.index);
    emit({ type: "start" });
    try {
      await locks().withTxLock(address, () =>
        finishDeposit({ position, seed: w.seed!, signTransaction: w.signTransaction, emit }),
      );
    } catch (e) {
      emit({ type: "failed", error: e });
    }
  }, [address, w.seed, w.signTransaction, registering, pendingTxid, emit]);

  const checkTxid = useCallback(async () => {
    const txid = ui.txid.trim().toLowerCase();
    if (!TXID.test(txid)) return ui.setTxidCheck({ kind: "invalid" });
    if (!p2wsh) return;
    ui.setTxidCheck({ kind: "checking" });
    try {
      const out = await depositDeps.findOutput(txid, p2wsh);
      if (out === "no_output") ui.setTxidCheck({ kind: "no_output" });
      else if (out === "unseen") ui.setTxidCheck({ kind: "error", error: new Error("Bitcoin hasn't seen this transaction yet.") });
      else ui.setTxidCheck({ kind: "found", sats: out.sats });
    } catch (error) {
      ui.setTxidCheck({ kind: "error", error });
    }
  }, [ui, p2wsh]);

  const confirmTxid = useCallback(async () => {
    if (!address || !b.btcPubkey || !p2wsh || pending) return;
    setAction("txid");
    ui.setTxidCheck({ kind: "saving" });
    try {
      const pd = await startDepositFromTxid({
        owner: address,
        p2wsh,
        btcPubkey: b.btcPubkey,
        usedIndices: positionsSnapshot(address).map((p) => p.index),
        emit,
        txid: ui.txid,
      });
      setCreatedHere(pd.btcTxid);
      ui.setNewDeviceOpen(false);
    } catch (error) {
      ui.setTxidCheck(/does not pay/.test(String(error)) ? { kind: "no_output" } : { kind: "error", error });
    }
  }, [address, b.btcPubkey, p2wsh, pending, emit, ui]);

  const sending = !pending && action === "send" && isInFlight(flow);
  const stage = pending ? depositStage(pending, status.status.kind, flow) : null;
  const done = flow.phase === "settled" && !pending;
  const r = route(ui, { done, stage, sending, stellarReady, bitcoinReady });

  const foundOnLoad = Boolean(pending) && pendingTxid !== createdHere;
  const otherTx = txLock === "elsewhere" || (txLock === "here" && !isInFlight(flow));

  return {
    ...r,
    unavailable,
    busy: isInFlight(flow) || signing || w.connecting || b.connecting,
    amount: {
      value: ui.amount,
      error: ui.amountError,
      balanceSats: balance?.kind === "ok" ? balance.value : null,
      set: ui.setAmount,
      submit: ui.submitAmount,
    },
    sats,
    priceStroops: BigInt(config.btcPriceStroops),
    stellar: {
      address,
      walletName,
      connecting: w.connecting,
      connectError: w.error ? { declined: /reject|declin|cancel|closed/i.test(w.error), raw: w.error } : null,
      wrongNetwork,
      funding,
      fundBusy,
      fundError,
      lowAck: lowAckFor === address,
      loans,
      loansCount: findState?.count ?? 0,
      loansError: findState?.error ?? null,
      signError,
      ready: stellarReady,
      connect: () => void w.connect(),
      useOther: () => {
        w.disconnect();
        void w.connect();
      },
      sign: () => {
        setSignError(null);
        setSigning(true);
        w.unlock()
          .catch((e: unknown) => setSignError(e))
          .finally(() => setSigning(false));
      },
      retryFind: () => setFindNonce((n) => n + 1),
      fund: () => {
        if (!address || !ON_TESTNET) return;
        setFundBusy(true);
        setFundError(null);
        fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`)
          .then((res) => {
            if (!res.ok && res.status !== 400) throw new Error(`Friendbot error ${res.status}`);
          })
          .catch((e: unknown) => setFundError(e))
          .finally(() => {
            setFundBusy(false);
            setFundNonce((n) => n + 1);
          });
      },
      recheckFunding: () => setFundNonce((n) => n + 1),
      ackLow: () => setLowAckFor(address),
    },
    bitcoin: {
      address: btcAddress,
      connecting: b.connecting,
      error: bitcoinError(b.error),
      balance,
      ready: bitcoinReady,
      connect: () => void b.connect(),
      useOther: () => {
        b.disconnect();
        void b.connect();
      },
      recheck: () => setBalanceNonce((n) => n + 1),
    },
    review: {
      lockAddress: pending?.p2wsh ?? p2wsh,
      timelockHeight: config.bitcoin.timelockHeight,
      exitDate: blocksLeft !== null && chainCtx ? exitDate(blocksLeft, chainCtx.at) : null,
      feeSats: chainCtx?.feeRate ? estimateFeeSats(chainCtx.feeRate) : null,
      tooClose: blocksLeft !== null && blocksLeft < TIMELOCK_MIN_BLOCKS_LEFT,
      ack: ui.ack,
      slideKey: ui.slideKey,
      setAck: ui.setAck,
      send: () => void send(),
    },
    newDevice: {
      open: ui.newDeviceOpen,
      txid: ui.txid,
      check: ui.txidCheck,
      setOpen: ui.setNewDeviceOpen,
      setTxid: ui.setTxid,
      submit: () => void checkTxid(),
      confirm: () => void confirmTxid(),
    },
    deposit: {
      pending,
      status,
      flow,
      m: pending?.required ?? (flow.phase === "waiting_btc" ? flow.required : config.bitcoin.minConfirmations),
      relayerUnreachable: flow.phase === "waiting_btc" && !flow.relayerReachable,
      drivenElsewhere,
      otherTx,
      foundOnLoad,
      secondBlocked: foundOnLoad && ui.amountConfirmed,
      unlocked: w.unlocked,
      recheck: () => {
        refreshStatus(local);
        if (!isInFlight(flow)) setRunKey((k) => k + 1);
      },
      register: () => void register(),
      finish: () => void finish(),
    },
    done: {
      sats: doneSats,
      index: doneIndex,
      reset: () => {
        emit({ type: "reset" });
        setAction(null);
        setDoneSats(null);
        setDoneIndex(null);
        setRegistering(null);
        ui.reset();
      },
    },
  };
}
