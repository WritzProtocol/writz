import { AppNav } from "@/components/redesign/AppNav";
import { Shell } from "@/components/shell/Shell";
import "./redesign.css";

export default function RedesignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="wz">
      <a className="wz-skip" href="#content">
        Skip to content
      </a>
      <Shell top={<AppNav />}>{children}</Shell>
    </div>
  );
}
