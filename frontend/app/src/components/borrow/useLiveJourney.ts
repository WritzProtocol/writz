"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Horizon, NotFoundError } from "@stellar/stellar-sdk";
import { config } from "@/config";
import { confirmationTarget } from "@/lib/borrow/depositStatus";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";
import { useDepositLock } from "@/lib/bitcoin/useDepositLock";
import { ensureKit } from "@/lib/wallet/kit";
import { networkName } from "@/lib/wallet/precheck";
import { useFlow, useTxLockState } from "@/lib/flow/useFlow";
import { isInFlight } from "@/lib/flow/engine";
import { depositLockName, locks } from "@/lib/flow/lock";
import { pendingDeposits } from "@/lib/flow/pendingDeposit";
import { recentActivity } from "@/lib/tray";
import { currentRoute, notifySettled } from "@/lib/toast";
import { loanHref } from "@/lib/loan/model";
import { clearDraftAmount, readDraftAmount } from "@/lib/borrow/draft";
import { getBtcPriceStroops } from "@/lib/contracts/oracle";
import { depositDeps, registerDeposit, startDepositBySending, startDepositFromTxid, trackDeposit } from "@/lib/flows/deposit";
import { discoverPositions } from "@/lib/flows/discover";
import { positionsSnapshot } from "@/lib/position";
import { esploraReads } from "@/lib/status/client";
import { usePositionStatus, useRefreshStatus } from "@/lib/status/provider";
import type { LocalInputs } from "@/lib/status/types";
import {
  btcBalanceOf,
  depositStage,
  estimateFeeSats,
  exitDate,
  fundingOf,
  parseBtcAmount,
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

function notifyRegistered(origin: string, index: number) {
  notifySettled(origin, { href: loanHref(index, "borrow"), label: "Borrow now" }, { ok: true, text: `Deposit registered on Stellar. Loan ${index + 1} is ready.` });
}

export function useLiveJourney(): JourneyModel {
  const w = useWallet();
  const b = useBitcoinWallet();
  const [draft] = useState(readDraftAmount);
  useEffect(clearDraftAmount, []);
  const ui = useJourneyUi({ amount: draft && parseBtcAmount(draft).ok ? draft : undefined });
  const [flow, emit] = useFlow();
  const address = w.address;

  const pending = useSyncExternalStore(
    pendingDeposits.subscribe,
    () => (address ? pendingDeposits.snapshot(address) : null),
    () => null,
  );
  const pendingTxid = pending?.btcTxid ?? null;
  const txLock = useTxLockState(address);

  const [action, setAction] = useState<"send" | "register" | "txid" | null>(null);
  const [createdHere, setCreatedHere] = useState<string | null>(null);
  const [doneSats, setDoneSats] = useState<bigint | null>(null);
  const [doneIndex, setDoneIndex] = useState<number | null>(null);
  const [doneTxid, setDoneTxid] = useState<string | null>(null);
  const [drivenElsewhere, setDrivenElsewhere] = useState(false);
  const [runKey, setRunKey] = useState(0);

  // ── Status of the deposit in progress ──
  const local = useMemo<LocalInputs | null>(
    () =>
      pending ? { position: null, pendingDeposit: pending } : null,
    [pending],
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
        if (result.status === "active") {
          setDoneSats(BigInt(result.position.collateralSats));
          setDoneIndex(result.position.index);
          setDoneTxid(result.position.txid);
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
  const walletName = w.walletBackend === "pollar" ? "Pollar" : (net?.walletName ?? "your wallet");

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

  // Loans are public on chain: finding them needs no signature, only the connected address.
  const [find, setFind] = useState<{ key: string; state: "found" | "failed"; count: number; error?: unknown } | null>(null);
  const [findNonce, setFindNonce] = useState(0);
  const findKey = address ? `${address}:${findNonce}` : null;
  useEffect(() => {
    if (!address) return;
    let live = true;
    const key = `${address}:${findNonce}`;
    discoverPositions(address)
      .then(({ found }) => live && setFind({ key, state: "found", count: found }))
      .catch((error: unknown) => live && setFind({ key, state: "failed", count: 0, error }));
    return () => {
      live = false;
    };
  }, [address, findNonce]);
  const findState = find?.key === findKey ? find : null;
  const loans = findState?.state ?? "finding";

  const fundingOk =
    funding.kind === "failed" ||
    (funding.kind === "ok" && (funding.value.kind === "ok" || (funding.value.kind === "low" && (lowAckFor === address || w.walletBackend === "pollar"))));
  const stellarReady = Boolean(address) && !wrongNetwork && fundingOk && loans === "found";

  // ── Price: the oracle writz-lend prices collateral with ──
  const [price, setPrice] = useState<bigint | null>(null);
  useEffect(() => {
    let live = true;
    getBtcPriceStroops()
      .then((p) => live && setPrice(p))
      .catch(() => live && setPrice(null));
    return () => {
      live = false;
    };
  }, []);

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

  const depositLock = useDepositLock(b.btcPubkey);
  const lock = depositLock.kind === "ready" ? depositLock.lock : null;
  const p2wsh = lock?.p2wsh ?? null;
  const timelockHeight = pending?.timelockHeight ?? lock?.timelockHeight ?? null;

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
  const blocksLeft = chainCtx?.tip != null && timelockHeight !== null ? timelockHeight - chainCtx.tip : null;

  // ── Actions ──
  const unavailable = !config.bitcoin.protocolPubkey || !config.services.relayerUrl || !config.contracts.writzLend;

  const send = useCallback(async () => {
    if (!address || !b.btcPubkey || !lock || !sats || pending) return;
    setAction("send");
    emit({ type: "start" });
    try {
      const pd = await startDepositBySending({
        owner: address,
        lock,
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
  }, [address, b.btcPubkey, b.sendBtc, lock, sats, pending, emit, ui]);

  const register = useCallback(async () => {
    if (!address || !pending) return;
    setAction("register");
    setDoneSats(BigInt(pending.sats));
    setDoneIndex(pending.positionIndex);
    setDoneTxid(pending.btcTxid);
    emit({ type: "start" });
    const origin = currentRoute();
    const index = pending.positionIndex;
    try {
      // The deposit must be signed by the Bitcoin key its output is locked to,
      // so the wallet that sent it has to be the one connected now.
      if (!b.btcPubkey || b.btcPubkey !== pending.btcPubkey) {
        throw new Error("Connect the Bitcoin wallet that sent this deposit, then try again.");
      }
      await locks().withTxLock(address, () =>
        registerDeposit({
          owner: address,
          signTransaction: w.signTransaction,
          signKeyProof: b.signMessage,
          emit,
        }),
      );
      notifyRegistered(origin, index);
    } catch (e) {
      emit({ type: "failed", error: e });
      notifySettled(origin, { href: origin, label: "Open deposit" }, { ok: false, error: e, what: "Registering your deposit" });
    }
  }, [address, w.signTransaction, b.btcPubkey, b.signMessage, pending, emit]);

  /** Saves a deposit that is on chain but not yet on this device (B31): it only reads, never deposits again. */
  const finish = useCallback(() => {
    setAction("register");
    setRunKey((k) => k + 1);
  }, []);

  const checkTxid = useCallback(async () => {
    const txid = ui.txid.trim().toLowerCase();
    if (!TXID.test(txid)) return ui.setTxidCheck({ kind: "invalid" });
    if (!b.btcPubkey) return;
    ui.setTxidCheck({ kind: "checking" });
    try {
      const out = await depositDeps.locateDeposit(txid, b.btcPubkey);
      if (out === "no_output") ui.setTxidCheck({ kind: "no_output" });
      else if (out === "unseen") ui.setTxidCheck({ kind: "error", error: new Error("Bitcoin hasn't seen this transaction yet.") });
      else ui.setTxidCheck({ kind: "found", sats: out.sats });
    } catch (error) {
      ui.setTxidCheck({ kind: "error", error });
    }
  }, [ui, b.btcPubkey]);

  const confirmTxid = useCallback(async () => {
    if (!address || !b.btcPubkey || pending) return;
    setAction("txid");
    ui.setTxidCheck({ kind: "saving" });
    try {
      const pd = await startDepositFromTxid({
        owner: address,
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
  }, [address, b.btcPubkey, pending, emit, ui]);

  const settledHash = flow.phase === "settled" ? flow.hash : undefined;
  useEffect(() => {
    if (!address || !settledHash) return;
    recentActivity.add(address, { hash: settledHash, chain: "stellar", label: "Deposit registered on Stellar", at: Date.now() });
  }, [address, settledHash]);

  const sending = !pending && action === "send" && isInFlight(flow);
  const stage = pending ? depositStage(pending, status.status.kind, flow) : null;
  const done = flow.phase === "settled" && !pending;
  const r = route(ui, { done, stage, sending, stellarReady, bitcoinReady });

  const foundOnLoad = Boolean(pending) && pendingTxid !== createdHere;
  const otherTx = txLock === "elsewhere" || (txLock === "here" && !isInFlight(flow));

  return {
    ...r,
    unavailable,
    busy: isInFlight(flow) || w.connecting || b.connecting,
    amount: {
      value: ui.amount,
      error: ui.amountError,
      balanceSats: balance?.kind === "ok" ? balance.value : null,
      set: ui.setAmount,
      submit: ui.submitAmount,
    },
    sats,
    priceStroops: price,
    stellar: {
      address,
      walletName,
      connecting: w.connecting,
      connectError: w.error ? { declined: /reject|declin|cancel|closed/i.test(w.error), raw: w.error } : null,
      wrongNetwork,
      funding,
      fundBusy,
      fundError,
      lowAck: lowAckFor === address || w.walletBackend === "pollar",
      loans,
      loansCount: findState?.count ?? 0,
      loansError: findState?.error ?? null,
      ready: stellarReady,
      connect: () => void w.connect(),
      useOther: () => {
        w.disconnect();
        void w.connect();
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
      timelockHeight,
      lockFailed: !pending && depositLock.kind === "failed",
      retryLock: () => depositLock.kind === "failed" && depositLock.retry(),
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
      m: confirmationTarget(
        [pending?.required, flow.phase === "waiting_btc" ? flow.required : null],
        config.bitcoin.minConfirmations,
      ),
      relayerUnreachable: flow.phase === "waiting_btc" && !flow.relayerReachable,
      drivenElsewhere,
      otherTx,
      foundOnLoad,
      secondBlocked: foundOnLoad && ui.amountConfirmed,
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
      btcTxid: doneTxid,
      stellarTxHash: flow.phase === "settled" ? (flow.hash ?? null) : null,
      reset: () => {
        emit({ type: "reset" });
        setAction(null);
        setDoneSats(null);
        setDoneIndex(null);
        setDoneTxid(null);
        ui.reset();
      },
    },
  };
}
