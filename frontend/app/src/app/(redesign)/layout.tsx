import { TopBar } from "@/components/redesign/TopBar";
import { Shell } from "@/components/shell/Shell";
import "./redesign.css";

export default function RedesignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="wz">
      <a className="wz-skip" href="#content">
        Skip to content
      </a>
      <Shell top={<TopBar />}>{children}</Shell>
    </div>
  );
}
