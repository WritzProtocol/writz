"use client";

import { useId, useState } from "react";
import { useBitcoinWallet, type EmbeddedSignet } from "@/lib/bitcoin/useBitcoinWallet";
import { ErrorBox, Notice } from "@/components/ui";
import * as ui from "@/components/ui/styles";

function download(text: string, address: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `writz-signet-test-key-${address.slice(-6)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Back up or restore the Signet test key: one file, one screen. */
function BackupRestore({ e, onDone }: { e: EmbeddedSignet; onDone(): void }) {
  const id = useId();
  const [error, setError] = useState<unknown>(null);
  const [restored, setRestored] = useState(false);
  const [saved, setSaved] = useState(false);

  const restore = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setRestored(false);
    try {
      e.importFile(await file.text());
      setRestored(true);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className={ui.stack} style={{ gap: 12 }}>
      <p className={ui.hint}>
        The key file moves this test key to another browser. Anyone with it can spend the key&apos;s test coins, which have no value.
      </p>
      <div className={ui.actions}>
        <button
          type="button"
          className={ui.btn("gold", "sm")}
          onClick={() => {
            download(e.exportFile(), e.address);
            setSaved(true);
          }}
        >
          Download key file
        </button>
        <button type="button" className={ui.btn("line", "sm")} onClick={onDone}>
          Close
        </button>
      </div>
      {saved ? <p className={ui.hint}>Saved. Keep the file somewhere private.</p> : null}
      <label htmlFor={`${id}-file`} className={ui.label}>
        Restore from a key file
      </label>
      <input id={`${id}-file`} type="file" accept=".json,.txt,application/json,text/plain" onChange={(ev) => void restore(ev.target.files?.[0])} />
      <p className={ui.hint}>Restoring replaces the test key in this browser. Back up the current one first if it holds coins or a loan.</p>
      {restored ? (
        <Notice tone="positive" label="Restored">
          <p>This browser now uses the restored test key.</p>
        </Notice>
      ) : null}
      {error ? <ErrorBox error={error} label="Not restored" tone="warning" /> : null}
    </div>
  );
}

/** The Bitcoin section of the account sheet for a social sign-in with its Signet test key. */
export function TestKeyPanel() {
  const b = useBitcoinWallet();
  const [open, setOpen] = useState(false);
  const e = b.embedded;
  if (!e) return null;

  if (!e.active) {
    return (
      <div className={ui.actions}>
        <button type="button" className={ui.btn("line", "sm")} onClick={e.use}>
          Use my Signet test key
        </button>
      </div>
    );
  }

  return (
    <>
      <p className={ui.hint}>
        <b>Signet test key, worthless coins.</b> It lives only in this browser, not with Writz or Pollar. For testing only.
      </p>
      {open ? (
        <BackupRestore e={e} onDone={() => setOpen(false)} />
      ) : (
        <div className={ui.actions}>
          <button type="button" className={ui.btn("line", "sm")} onClick={() => setOpen(true)}>
            Back up or restore
          </button>
          <button type="button" className={ui.btn("text")} disabled={b.connecting} onClick={b.connect}>
            {b.connecting ? "Confirm in Xverse" : "Use Xverse instead"}
          </button>
        </div>
      )}
    </>
  );
}
