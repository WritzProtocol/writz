"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { StatusProvider } from "@/lib/status/provider";
import { AccountProvider, useShellAccount } from "./account";

/** After a client-side route change, focus the new page's heading so screen readers start there. */
function useFocusHeadingOnRoute() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>("#content h1") ?? document.getElementById("content");
      if (!target) return;
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
}

function Main({ top, children }: { top: React.ReactNode; children: React.ReactNode }) {
  const a = useShellAccount();
  useFocusHeadingOnRoute();
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
