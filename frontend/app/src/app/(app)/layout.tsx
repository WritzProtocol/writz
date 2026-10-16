import { AppNav } from "@/components/shell/AppNav";
import { Shell } from "@/components/shell/Shell";
import "./ui.css";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <a className="wz-skip" href="#content">
        Skip to content
      </a>
      <Shell top={<AppNav />}>{children}</Shell>
    </div>
  );
}
