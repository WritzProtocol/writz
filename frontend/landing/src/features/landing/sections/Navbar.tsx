"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import { APP_ROUTE } from "../constants";
import { navItems } from "../data/navigation.data";
import * as l from "../styles";

export function Navbar() {
  const [floating, setFloating] = useState(false);

  useEffect(() => {
    const update = () => setFloating(window.scrollY > 16);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  // Already home: Link would not scroll back up, so do it here and drop any #section.
  const toTop = (e: MouseEvent) => {
    if (window.location.pathname !== "/") return;
    e.preventDefault();
    window.history.replaceState(null, "", "/");
    window.scrollTo({ top: 0 });
  };

  return (
    <header className={l.nav} data-floating={floating}>
      <div className={l.navBar}>
        <Link href="/" aria-label="Writz" onClick={toTop} className={l.navHome}>
          <span className={l.navLockup} />
        </Link>
        <div className={l.navEnd}>
          <nav className={l.navLinks}>
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={l.navLink(Boolean(item.keepOnMobile))}
                data-umami-event="nav-link"
                data-umami-event-label={item.label}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <span className={l.navTag}>
            <span className={l.heroTagDot} />
            Live on Stellar testnet
          </span>
          <a className={l.navCta} href={APP_ROUTE} data-umami-event="open-app" data-umami-event-where="nav">
            Open app
          </a>
        </div>
      </div>
    </header>
  );
}
