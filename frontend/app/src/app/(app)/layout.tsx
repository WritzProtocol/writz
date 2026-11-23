import { AppNav } from "@/components/shell/AppNav";
import { Shell } from "@/components/shell/Shell";
import { UI_MOCK } from "@/lib/mock/gate";
import { skeletonHints, skeletonScript } from "@/lib/mock/hint";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app group/app relative z-1 min-h-svh bg-bg text-body font-sans text-[16px] leading-normal antialiased scheme-dark lg:pl-(--rail)">
      <script dangerouslySetInnerHTML={{ __html: skeletonScript(UI_MOCK ? skeletonHints() : null) }} />
      <a className="absolute left-4 -top-16 z-60 py-[10px] px-4 bg-accent text-on-accent font-medium focus:top-3 focus-visible:outline-2 focus-visible:outline-heading focus-visible:outline-offset-2" href="#content">
        Skip to content
      </a>
      <Shell top={<AppNav />}>{children}</Shell>
    </div>
  );
}
