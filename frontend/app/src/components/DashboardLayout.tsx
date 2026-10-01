"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  FileText,
  Menu,
  X,
  ExternalLink,
} from "lucide-react";
import { WalletButton } from "@/components/WalletButton";
import { BitcoinWalletButton } from "@/components/BitcoinWalletButton";
import { config } from "@/config";

interface Props {
  children: React.ReactNode;
  breadcrumbs: { label: string; href?: string; active?: boolean }[];
}

export function DashboardLayout({ children, breadcrumbs }: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    {
      label: "COMMAND CENTER",
      href: "/",
      icon: LayoutDashboard,
      active: pathname === "/",
    },
    {
      label: "EARN METRICS",
      href: "/metrics",
      icon: TrendingUp,
      active: pathname === "/metrics",
    },
    {
      label: "INTELLIGENCE (DOCS)",
      href: "https://docs.writz.xyz",
      icon: FileText,
      external: true,
      active: false,
    },
  ];

  return (
    <div className="flex min-h-screen bg-obsidian text-body font-sans antialiased">
      {/* ── Desktop Sidebar ────────────────────────────────────────── */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-line bg-surface/90 backdrop-blur-sm">
        {/* Brand header */}
        <div className="flex h-16 items-center justify-between border-b border-line px-5">
          <Link href="/" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- matches this codebase's existing plain-<img> convention (no next/image usage anywhere else) */}
            <img src="/brand/writz-mark-white.svg" alt="Writz" className="h-6 w-auto" />
            <span className="font-mono text-xs font-bold tracking-widest text-amber">
              WRITZ PROTOCOL
            </span>
          </Link>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 space-y-1.5 p-3" aria-label="Sidebar navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            if (item.external) {
              return (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded px-3 py-2.5 text-xs font-mono tracking-wider text-muted transition-colors hover:bg-surface-2 hover:text-head"
                >
                  <div className="flex items-center gap-3">
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </div>
                  <ExternalLink size={12} className="opacity-60" />
                </a>
              );
            }

            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 rounded px-3 py-2.5 text-xs font-mono tracking-wider transition-colors ${
                  item.active
                    ? "bg-amber text-[#0a0908] font-bold shadow-sm"
                    : "text-muted hover:bg-surface-2 hover:text-head"
                }`}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* ── Main Layout Column ─────────────────────────────────────── */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-line bg-surface/80 px-4 sm:px-6 backdrop-blur-md">
          {/* Mobile hamburger + Breadcrumbs */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-1.5 text-muted hover:text-head"
              aria-label="Toggle navigation menu"
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            <nav aria-label="Breadcrumb" className="flex items-center gap-2 font-mono text-xs tracking-wider">
              {breadcrumbs.map((crumb, idx) => (
                <div key={crumb.label} className="flex items-center gap-2">
                  {idx > 0 && <span className="text-line-2">/</span>}
                  {crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="text-muted hover:text-head transition-colors"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      className={
                        crumb.active ? "text-amber font-bold" : "text-muted"
                      }
                    >
                      {crumb.label}
                    </span>
                  )}
                </div>
              ))}
            </nav>
          </div>

          {/* Right actions: network pills + wallet buttons */}
          <div className="flex items-center gap-2.5 sm:gap-4">
            <div className="hidden sm:flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-mono text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-zk" />
                {config.target === "mainnet" ? "Stellar" : "Stellar testnet"}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-mono text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-amber" />
                Bitcoin {config.bitcoin.network}
              </span>
            </div>
            <BitcoinWalletButton />
            <WalletButton />
          </div>
        </header>

        {/* Mobile menu dropdown */}
        {mobileOpen && (
          <div className="lg:hidden border-b border-line bg-surface p-4 space-y-2 font-mono text-xs">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 rounded p-2.5 ${
                    item.active
                      ? "bg-amber text-[#0a0908] font-bold"
                      : "text-muted hover:bg-surface-2 hover:text-head"
                  }`}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        )}

        {/* Main Content Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
