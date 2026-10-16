import { AppNav } from "@/components/shell/AppNav";
import { Shell } from "@/components/shell/Shell";
import { UI_MOCK } from "@/lib/mock/gate";
import { skeletonHints, skeletonScript } from "@/lib/mock/hint";
import "./ui.css";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <script dangerouslySetInnerHTML={{ __html: skeletonScript(UI_MOCK ? skeletonHints() : null) }} />
      <a className="wz-skip" href="#content">
        Skip to content
      </a>
      <Shell top={<AppNav />}>{children}</Shell>
    </div>
  );
}
