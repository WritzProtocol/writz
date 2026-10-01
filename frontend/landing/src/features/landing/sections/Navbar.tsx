"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import { APP_ROUTE } from "../constants";
import { navItems } from "../data/navigation.data";

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
    <header className="nav" data-floating={floating}>
      <div className="nav-bar">
        <Link href="/" aria-label="Writz" onClick={toTop}>
          <span className="lockup" />
        </Link>
        <nav className="nav-links">
          {navItems.map((item) => (
            <a key={item.label} href={item.href} className={item.keepOnMobile ? "keep" : undefined}>
              {item.label}
            </a>
          ))}
          <a className="btn btn-gold" href={APP_ROUTE}>
            Open app
          </a>
        </nav>
      </div>
    </header>
  );
}
