import { Work_Sans } from "next/font/google";
import { TopBar } from "@/components/redesign/TopBar";
import "./redesign.css";

const workSans = Work_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--ff-wz" });

export default function RedesignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${workSans.variable} wz`}>
      <a className="wz-skip" href="#content">
        Skip to content
      </a>
      <TopBar />
      <main id="content" className="wz-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
