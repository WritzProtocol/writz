import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UI_MOCK } from "@/lib/mock/gate";
import { scenarioCatalog } from "@/lib/mock/catalog";
import "./dev.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mock scenarios | Writz",
  robots: { index: false, follow: false },
};

export default function DevScenarios() {
  const groups = scenarioCatalog(UI_MOCK);
  if (!groups) notFound();
  const total = groups.reduce((n, g) => n + g.entries.length, 0);

  return (
    <div className="dv">
      <header className="dv-head">
        <h1>Mock scenarios</h1>
        <p>
          Every state the mock harness can render, {total} in all, read live from <span className="mono">scenarios.ts</span>. Open one to see
          the page in that state.
        </p>
        <nav aria-label="Areas" className="dv-areas">
          {groups.map((g) => (
            <a key={g.area} href={`#dv-${g.area}`} className="wz-chip">
              {g.label}
            </a>
          ))}
        </nav>
      </header>
      {groups.map((g) => (
        <section key={g.area} id={`dv-${g.area}`} className="dv-group" aria-labelledby={`dv-${g.area}-h`}>
          <h2 id={`dv-${g.area}-h`}>
            {g.label} <span className="dv-count">{g.entries.length}</span>
          </h2>
          <ul className="dv-list">
            {g.entries.map((e) => (
              <li key={e.id}>
                <a href={e.href}>
                  <span className="mono dv-id">{e.id}</span>
                  <span className="dv-name">{e.title}</span>
                  <span className="mono dv-route">{e.route}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
