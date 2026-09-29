"use client";

import { useEffect, useState } from "react";
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

  return (
    <header className="nav" data-floating={floating}>
      <div className="nav-bar">
        <a href="#top" aria-label="Writz">
          <span className="lockup" />
        </a>
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
