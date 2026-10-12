"use client";

import { StatusProvider } from "@/lib/status/provider";
import { AccountProvider, useShellAccount } from "./account";

function Main({ top, children }: { top: React.ReactNode; children: React.ReactNode }) {
  const a = useShellAccount();
  return (
    <>
      {top}
      <main id="content" className="wz-main" tabIndex={-1}>
        {a.mainnetGuard ? (
          <section className="hm-guard" role="alert">
            <h1 className="hm-h1">This build is set up for Stellar testnet only.</h1>
            <p className="wz-muted">It points at a different network, so loans, Earn and Lend are turned off.</p>
          </section>
        ) : (
          children
        )}
      </main>
    </>
  );
}

export function Shell({ top, children }: { top: React.ReactNode; children: React.ReactNode }) {
  return (
    <StatusProvider>
      <AccountProvider>
        <Main top={top}>{children}</Main>
      </AccountProvider>
    </StatusProvider>
  );
}
