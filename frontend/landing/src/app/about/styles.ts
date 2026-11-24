import * as l from "@/features/landing/styles";
import * as b from "../brand/styles";

/** The about page. It sits on the same ground as the brand page, so it reuses its section and link styles. */

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export const root = b.root;
export const section = b.section;
export const sectionLast = cx(b.section, "border-b-0");

export const secHead =
  "flex flex-wrap items-baseline justify-between gap-y-2 gap-x-8 mb-10 [&_p]:m-0 [&_p]:max-w-[680px] [&_p]:text-[17px] max-[721px]:[&_p]:text-base [&_p]:leading-[1.6] [&_p]:text-muted";

/* Masthead: the introduction on the left, where it stands on the right */

export const masthead = "relative isolate overflow-hidden pt-[calc(72px+88px)] pb-24 border-b border-line max-[721px]:pt-[calc(72px+40px)] max-[721px]:pb-0";
export const field = [
  "absolute -z-1 top-[72px] bottom-0 -right-[40%] bg-surface [transform:skewX(-16deg)] origin-bottom-left max-[1101px]:hidden",
  // The bottom of the cut sits in the column gap; the -16deg lean then clears the text above it.
  "left-[calc((100%-min(100%-2*var(--gut),var(--max)))/2+min(100%-2*var(--gut),var(--max))-420px-200px)]",
  "motion-safe:animate-[landing-field_var(--dur-signature)_var(--ease-enter)_120ms_backwards]",
].join(" ");
export const mastIn = cx(l.wrap, "grid grid-cols-[minmax(0,1fr)_420px] max-[1101px]:grid-cols-[minmax(0,1fr)] gap-[220px] max-[1101px]:gap-12 items-center");
export const h1 = cx(b.h1, "mb-7 text-[length:clamp(48px,5.4vw,76px)] max-[721px]:text-[length:clamp(48px,5.4vw,76px)] tracking-[-0.035em] leading-none text-balance");
export const lead =
  "max-w-[26em] m-0 text-[21px] max-[721px]:text-[18px] leading-[1.45] tracking-[-0.008em] text-body text-pretty";

/** "Where it stands": a column beside the lead; below 1100px it becomes a cut-corner band under it. */
export const status = [
  "p-0 border-0",
  "max-[1101px]:mx-[calc(-1*var(--gut))] max-[1101px]:pt-[72px] max-[1101px]:px-(--gut) max-[1101px]:pb-8 max-[1101px]:bg-surface max-[1101px]:[clip-path:polygon(40px_0,100%_0,100%_100%,0_100%,0_139.5px)]",
  "max-[721px]:pt-16 max-[721px]:pb-6 max-[721px]:[clip-path:polygon(24px_0,100%_0,100%_100%,0_100%,0_83.7px)]",
].join(" ");
export const statusHeading = "mb-5 text-[21px] tracking-[-0.014em]";
export const statusList =
  "m-0 max-[1101px]:grid max-[1101px]:grid-cols-[repeat(2,minmax(0,1fr))] max-[721px]:grid-cols-[minmax(0,1fr)] max-[1101px]:gap-y-0 max-[1101px]:gap-x-8 [&>div]:py-4 [&>div]:border-t [&>div]:border-line-strong [&_dd]:m-0 [&_dd]:text-[16px] [&_dd]:leading-normal [&_dd]:text-pretty";
export const statusTerm = "flex items-center gap-[10px] mb-1 text-[14px] font-medium text-heading";
export const statusTick = "flex-none inline-block w-1.5 h-3 bg-mark -skew-x-16";

/* Team */

export const team =
  "grid grid-cols-[repeat(4,minmax(0,1fr))] max-[1101px]:grid-cols-[repeat(2,minmax(0,1fr))] max-[721px]:grid-cols-[minmax(0,1fr)] gap-2 m-0 p-0 list-none";
export function member(i: number): string {
  return cx(
    "flex flex-col min-w-0 pt-8 px-6 pb-5 max-[721px]:pt-7 max-[721px]:px-5 max-[721px]:pb-3 [clip-path:polygon(20px_0,100%_0,100%_100%,0_100%,0_70px)]",
    i % 2 === 1 ? "bg-deep" : "bg-surface",
  );
}
export const avatar =
  "relative w-28 h-21 mt-0 mr-0 mb-7 ml-2 bg-bg [clip-path:polygon(24px_0,100%_0,calc(100%-24px)_100%,0_100%)] max-[721px]:w-21 max-[721px]:h-[63px] max-[721px]:mb-5 max-[721px]:[clip-path:polygon(18px_0,100%_0,calc(100%-18px)_100%,0_100%)]";
export const initials = "absolute inset-0 grid place-items-center text-[22px] font-semibold tracking-[-0.01em] text-accent";
export const photo = "absolute inset-0 [background:center_30%/cover_no-repeat] [filter:grayscale(1)_contrast(1.05)]";
export const memberName = "m-0 text-[21px] font-semibold tracking-[-0.014em] leading-[1.25] text-heading";
export const role = "mt-1.5 mb-0 mx-0 max-w-[680px] text-[16px] font-medium leading-[1.4] text-accent";
export const scope = "mt-2 mb-0 mx-0 max-w-[680px] text-[15px] leading-normal";
export const links = "flex gap-y-1 gap-x-4 mt-auto mb-0 mx-0 pt-5 max-[721px]:pt-2 max-w-[680px] text-[14px] leading-[1.6]";
export const memberLink =
  "inline-flex items-center min-h-11 text-body hover:text-heading underline decoration-line-strong underline-offset-3 transition-[text-decoration-color] duration-micro ease-enter hover:decoration-accent pointer-coarse:py-[13px]";

/* Recognition */

export const awards = "grid grid-cols-[repeat(2,minmax(0,1fr))] max-[721px]:grid-cols-[minmax(0,1fr)] gap-2 m-0 p-0 list-none";
export const award = "flex flex-col gap-[10px] pt-10 px-8 pb-8 bg-surface border-t-2 border-accent";
export const kind = "text-[13px] font-medium tracking-[0.06em] uppercase text-accent";
export const what = "text-[28px] max-[721px]:text-2xl font-semibold tracking-[-0.02em] leading-[1.2] text-heading text-balance";
export const detail = "text-[16px] text-muted";
export const awardLink = cx(b.link, "inline-flex items-center gap-2 mt-4 text-[15px]");

/* Check it yourself */

export const proof = "m-0 p-0 list-none border-b border-line [&>li]:border-t [&>li]:border-line";
export const proofLink = cx(
  "grid grid-cols-[180px_minmax(0,1fr)_auto] max-[721px]:grid-cols-[minmax(0,1fr)_auto] gap-6 max-[721px]:gap-y-1 max-[721px]:gap-x-4 items-baseline py-5 px-4 max-[721px]:py-4 max-[721px]:px-0 text-body no-underline transition-[background-color] duration-micro ease-enter hover:bg-surface hover:decoration-accent focus-visible:outline-offset-[-2px] group/proof",
);
export const proofName = "text-[17px] font-medium text-heading";
export const proofNameMono = "font-[family-name:var(--font-mono)] text-[16px] font-medium text-heading tabular-nums tracking-[0]";
export const proofNote = "text-[16px] max-[721px]:text-[15px] max-[721px]:[grid-row:2] max-[721px]:[grid-column:1/-1]";
export const proofWhere =
  "inline-flex items-center gap-2 text-[14px] text-muted whitespace-nowrap transition-[color] duration-micro ease-enter group-hover/proof:text-accent";
export const proofArrow = "transition-[transform] duration-micro ease-enter group-hover/proof:[transform:translate(2px,-2px)]";

/* Contact */

export const contact = "pt-28 pb-[136px] max-[721px]:pt-18 max-[721px]:pb-24 text-center";
export const contactHeading = "mb-5 text-[17px] font-medium tracking-[0] text-muted";
export const email =
  "inline-block text-[length:clamp(32px,6vw,72px)] font-semibold tracking-[-0.035em] leading-[1.1] text-heading underline decoration-2 underline-offset-[0.16em] decoration-accent wrap-anywhere transition-[text-decoration-color] duration-micro ease-enter hover:text-accent";
export const contactText = "max-w-[36em] mt-7 mx-auto mb-0 text-[17px] max-[721px]:text-base leading-[1.6]";
