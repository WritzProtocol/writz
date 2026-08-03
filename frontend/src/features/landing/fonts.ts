import { Work_Sans } from "next/font/google";

/**
 * Self-hosted via next/font so there's no external Google Fonts request and
 * no FOUC. Scoped to the landing page only — apply `workSans.variable` on
 * the landing root element, never on <html>, so the rest of the app keeps
 * its own fonts (Fraunces / Hanken Grotesk / Geist Mono) untouched.
 */
export const workSans = Work_Sans({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--ff-landing-sans",
});
