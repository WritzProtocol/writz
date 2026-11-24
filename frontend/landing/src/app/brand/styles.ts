import * as l from "@/features/landing/styles";

/** The brand page and the pieces /about shares with it: masthead, sections, captions and link style. */

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export const root = cx(l.root, "press-root antialiased min-h-full");

/** A link in running text: heading colour, a faint underline that turns gold on hover. */
export const link =
  "text-heading underline decoration-line-strong underline-offset-3 transition-[text-decoration-color] duration-micro ease-enter hover:decoration-accent";
/** The same link inside a paragraph, which grows to a 44px tap area on touch screens. */
export const textLink = cx(link, "pointer-coarse:py-[13px]");
export const code = "font-[family-name:var(--ff-mono),ui-monospace,monospace] text-[0.92em] bg-surface-2 rounded-[4px] py-px px-[5px] text-heading";

/* Masthead */

export const masthead = "pt-[calc(72px+72px)] pb-14 border-b border-line max-[721px]:pt-[calc(72px+40px)] max-[721px]:pb-10";
export const h1 = "m-0 mb-5 text-[56px] max-[721px]:text-[38px] font-semibold tracking-[-0.03em] leading-[1.05] text-heading";
export const lead = "max-w-[640px] m-0 text-[21px] max-[721px]:text-[18px] leading-[1.45] tracking-[-0.008em] text-body text-pretty";
export const leadLink = cx(textLink, "pointer-coarse:px-[17px] pointer-coarse:-mx-[17px]");
export const index = "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-y-0 gap-x-6 mt-12 mb-0 mx-0 p-0 list-none";
export const indexLink =
  "flex items-baseline gap-3 py-3 border-t border-line text-[15px] font-medium text-body no-underline transition-[color] duration-micro ease-enter hover:text-heading hover:decoration-accent pointer-coarse:min-h-11";
export const num = "font-[family-name:var(--ff-mono),ui-monospace,monospace] text-[13px] font-normal tracking-[0] text-accent";
/** The number inside an eyebrow sits a little closer to its label. */
export const eyebrowNum = cx(num, "-mr-0.5");

/** The eyebrow on a page of running text: a paragraph, so it takes the paragraph measure and leading. */
export const eyebrow = cx(l.eyebrow, "max-w-[680px] leading-[1.6]");
export const h2 = "mb-3";

/* Sections */

export const section = "py-22 max-[721px]:py-14 border-b border-line last-of-type:border-b-0 scroll-mt-24";
export const h3 = "mt-12 mb-3 mx-0 text-[25px] max-[721px]:text-[21px] font-semibold tracking-[-0.014em] leading-[1.25] text-heading";
export const p = "max-w-[680px] m-0 mb-4 text-[17px] max-[721px]:text-[16px] leading-[1.6]";
export const caption = "max-w-[680px] mt-4 mb-0 mx-0 text-[15px] leading-[1.55] text-muted";

/** One surface for every specimen: the Ink card with a faint edge. */
export const surface = "bg-surface rounded-xl [box-shadow:var(--shadow-border)]";

/** Masked artwork, so a specimen can be tinted to any colour, including the wrong ones the misuse tiles show. */
export const mark = "flex-none bg-current aspect-[912/628] [mask:url(/brand/writz-mark.svg)_no-repeat_center/contain]";

/* Logo */

export const assets = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,196px),1fr))] gap-4 mt-9";
export const asset = cx(surface, "overflow-hidden");
export const stage = "flex items-center justify-center h-40 p-6 bg-bg";
export const meta = "flex flex-col gap-1.5 pt-[14px] px-[18px] pb-4";
export const name = "text-[15px] font-medium text-heading";
export const files =
  "flex gap-3 pointer-coarse:gap-1 font-[family-name:var(--ff-mono),ui-monospace,monospace] text-[13px]";
export const fileLink = cx(link, "pointer-coarse:inline-flex pointer-coarse:items-center pointer-coarse:min-w-11 pointer-coarse:min-h-11 pointer-coarse:-my-[13px]");

/* Clear space and size */

export const clearspace = cx(surface, "flex justify-center mt-8 py-10 px-6");
export const box = "relative border border-dashed border-accent rounded-[10px] max-[721px]:[zoom:0.62]";
export const unit = "absolute top-0 left-0 border-r border-b border-accent opacity-[0.55]";
export const ladder = cx(surface, "flex flex-wrap items-end justify-center gap-[42px] max-[721px]:gap-[22px] mt-8 pt-10 px-7 pb-7");
export const step = "text-center";
export const slot = "flex items-end justify-center h-[52px]";
export function stepTag(state?: string): string {
  return cx(
    "relative isolate inline-flex items-center gap-2 min-h-8 mt-3 px-4 font-[family-name:var(--ff-mono),ui-monospace,monospace] font-medium text-[13px] leading-none whitespace-nowrap before:absolute before:inset-y-0 before:inset-x-[5px] before:-z-1 before:bg-tint-10 before:-skew-x-16",
    state === "floor" ? "text-accent" : state === "dead" ? "text-danger" : "text-muted",
  );
}

/* Colour */

export const swatches = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,140px),1fr))] gap-[18px] mt-9";
export function chip(small = false): string {
  return cx(small ? "h-14" : "h-28", "rounded-xl [box-shadow:0_0_0_1px_var(--line-strong)]");
}
export const swatchName = "mt-[14px] mb-0.5 mx-0 text-[15px] font-medium text-heading";
export const hex = "font-[family-name:var(--ff-mono),ui-monospace,monospace] text-[14px] text-muted";
export const role = "mt-1.5 text-[14px] leading-[1.45]";
export const pairs = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,140px),1fr))] gap-[18px] mt-7";
export function pair({ split = false, fail = false }: { split?: boolean; fail?: boolean }): string {
  return cx(
    "rounded-xl",
    fail ? "[box-shadow:0_0_0_2px_var(--danger)]" : "[box-shadow:0_0_0_1px_var(--line)]",
    split ? "flex flex-col p-0 overflow-hidden" : "pt-[22px] px-[18px] pb-4",
  );
}
export const half = "pt-[22px] px-[18px] pb-4 [&+&]:pt-[14px]";
export const aa = "text-[34px] font-semibold tracking-[-0.02em] leading-none";
const RATIO = "font-[family-name:var(--ff-mono),ui-monospace,monospace] text-[13px] opacity-75";
export const ratioText = cx(RATIO, "mt-[14px]");
export const pairLabel = "text-[14px] font-medium";
export const statusLabel = cx(pairLabel, "mb-2");
export const statusRatio = RATIO;
export const plainLabel = cx(pairLabel, "mt-1.5 opacity-[0.85]");

/* Type */

export const specimen = cx(surface, "mt-8");
export const row = "flex items-baseline gap-6 max-[721px]:gap-[14px] py-[18px] px-6 max-[721px]:py-[14px] max-[721px]:px-4 [&+&]:border-t [&+&]:border-line";
export const spec =
  "flex-none w-[172px] max-[721px]:w-[116px] font-[family-name:var(--ff-mono),ui-monospace,monospace] text-[13px] whitespace-nowrap text-muted";
export const sample = "overflow-hidden text-ellipsis whitespace-nowrap text-heading";

/* Graphic language */

export const gfx = "grid grid-cols-[repeat(2,1fr)] max-[721px]:grid-cols-[1fr] gap-[18px] mt-8";
export const cell = cx(surface, "p-[22px]");
export const cap = "mb-4 text-[13px] font-medium tracking-[0.06em] uppercase text-muted";
export const note = "font-[family-name:var(--ff-mono),ui-monospace,monospace] text-[13px] text-muted";
export const tints = "flex gap-[5px] [&>span]:flex-1 [&>span]:h-8 [&>span]:rounded-[4px]";
/** The paragraph under the redaction bar: a note in mono, with a paragraph's measure and bottom margin. */
export const noteParagraph = "max-w-[680px] mt-0 mx-0 mb-4 font-[family-name:var(--ff-mono),ui-monospace,monospace] text-[13px] text-muted";
export const redact = "flex items-center gap-[9px] text-[15px] text-body";

/* Copy */

export const quote = cx(surface, "max-w-[780px] mt-6 mb-0 mx-0 py-6 px-[26px] [&_p]:text-heading [&_p:last-child]:mb-0");
export const quoteHead = "flex items-center justify-between gap-4 mb-[14px]";
export const quoteName = "text-[13px] font-medium tracking-[0.06em] uppercase text-muted";
export const copy =
  "pointer-coarse:relative py-1.5 px-3 border-none rounded-md bg-transparent [box-shadow:0_0_0_1px_var(--line-strong)] font-[inherit] text-[13px] font-medium text-heading cursor-pointer touch-manipulation transition-[box-shadow] duration-micro ease-enter hover:[box-shadow:0_0_0_1px_var(--heading)] pointer-coarse:after:absolute pointer-coarse:after:-inset-y-[9px] pointer-coarse:after:inset-x-0";

/* Misuse */

export const dont = "grid grid-cols-[repeat(3,1fr)] max-[861px]:grid-cols-[repeat(2,1fr)] max-[481px]:grid-cols-[1fr] gap-[18px] mt-8";
export const figure = cx(surface, "m-0 overflow-hidden");
export const dontStage = "flex items-center justify-center h-32 overflow-hidden bg-bg";
export const dontStageBusy = "flex items-center justify-center h-32 overflow-hidden relative bg-deep";
export const caption2 =
  "flex gap-2 py-3 px-4 text-[14px] leading-[1.4] text-body before:content-['×'] before:font-semibold before:text-danger";
export const block = "absolute";

/* Rules */

export const rules = "grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-8 mt-8 [&_ul]:m-0 [&_ul]:p-0 [&_ul]:list-none";
const RULE_ITEM =
  "relative py-3 pr-0 pl-6 border-t border-line text-[16px] leading-normal before:absolute before:top-3 before:left-0 before:font-semibold";
export const allowed = cx(RULE_ITEM, "before:content-['+'] before:text-accent");
export const forbidden = cx(RULE_ITEM, "before:content-['×'] before:text-danger");
export const colophon = "pt-2 pb-18 text-[15px] text-muted";
