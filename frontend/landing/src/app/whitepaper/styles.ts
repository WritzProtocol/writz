/**
 * The whitepaper: a light paper page in Graphite & Gold, apart from the dark landing. The root redefines the colour
 * tokens it reads (`--body`, `--muted`, `--rule`) and the paper variables the utilities below use.
 */

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export const root = [
  "paper-doc",
  "[--paper:#f6f7f8] [--panel:#ffffff] [--ink:var(--on-accent)] [--gold:var(--accent)] [--body:#4b515b] [--muted:#646a73] [--rule:#e2e4e8]",
  "min-h-svh bg-(--paper) text-body font-sans antialiased",
].join(" ");

export const wrap = "max-w-[1100px] mx-auto px-6";

/** Links in running text: the ink colour, a faint underline that darkens on hover; 44px tap areas on touch screens. */
const LINK =
  "text-(--ink) decoration-(--rule) underline-offset-3 transition-[text-decoration-color] duration-micro ease-enter hover:decoration-(--ink)";
export const link = LINK;
export const textLink = cx(LINK, "pointer-coarse:py-[13px]");

/* Masthead */

export const masthead = "pt-10 pb-18 max-[721px]:pt-8 max-[721px]:pb-12 border-b border-(--rule)";
export const lockup =
  "h-8 aspect-[355.44/100] bg-(--ink) [mask:url(/brand/writz-lockup.svg)_no-repeat_center/contain] mb-16 max-[721px]:mb-10";
export const h1 = "m-0 mb-5 text-[52px] max-[721px]:text-[34px] font-semibold tracking-[-0.028em] leading-[1.08] text-(--ink)";
export const lead = "max-w-[680px] m-0 text-[21px] max-[721px]:text-[18px] font-normal tracking-[-0.008em] leading-[1.45]";
export const docMeta =
  "flex flex-wrap gap-y-2 gap-x-7 mt-7 mb-0 mx-0 p-0 list-none text-[15px] text-muted [&_li]:m-0 [&_strong]:font-semibold [&_strong]:text-(--ink)";
export const docActions = "flex flex-wrap max-[721px]:flex-col gap-3 mt-8";

/** The buttons under the title. Ink on gold is 11.05:1; gold is a surface here, never type. */
const BTN =
  "inline-flex items-center max-[721px]:justify-center min-h-12 px-6 rounded-md border text-[16px] font-semibold tracking-[-0.005em] no-underline transition-[text-decoration-color] duration-micro ease-enter focus-visible:outline-2 focus-visible:outline-(--ink) focus-visible:outline-offset-3";
export function btn(primary = false): string {
  return cx(
    BTN,
    primary ? "bg-(--gold) border-(--gold)" : "bg-transparent border-(--ink)",
    "text-(--ink) hover:bg-(--ink) hover:border-(--ink) hover:text-(--paper) hover:no-underline",
  );
}

/* Sections */

export const section = "py-18 max-[721px]:py-12 border-b border-(--rule) last-of-type:border-b-0";
export const label = "max-w-[680px] mt-0 mx-0 mb-5 text-[13px] font-medium tracking-[0.06em] leading-[1.2] uppercase text-muted";
export const h2 = "m-0 mb-3 text-[36px] max-[721px]:text-[27px] font-semibold tracking-[-0.022em] leading-[1.15] text-(--ink)";
export const p = "max-w-[680px] m-0 mb-4 text-[17px] max-[721px]:text-base leading-[1.6]";
export const caption = "max-w-[680px] mt-[14px] mb-0 mx-0 text-[14px] leading-normal text-muted";

export const contributions =
  "max-w-[680px] m-0 py-0 pr-0 pl-[22px] list-decimal [&_li]:m-0 [&_li]:mb-[14px] [&_li]:text-[17px] [&_li]:leading-[1.6] [&_strong]:font-semibold [&_strong]:text-(--ink)";
export const contents =
  "max-w-none m-0 p-0 list-none border-t border-(--rule) [&_li]:flex [&_li]:gap-5 [&_li]:m-0 [&_li]:py-3 [&_li]:px-0 [&_li]:border-b [&_li]:border-(--rule) [&_li]:text-[17px] [&_li]:leading-[1.6]";
export const contentsNum = "flex-[0_0_28px] pt-0.5 font-[family-name:var(--ff-mono),ui-monospace,monospace] text-[14px] text-muted";
export const contentsName = "font-medium text-(--ink)";
export const contentsNote = "block text-[15px] leading-[1.45] text-muted";

/* Citing */

export const quote =
  "max-w-[760px] mt-5 mb-0 mx-0 py-6 px-[26px] rounded-md border border-(--rule) bg-(--panel) [&_p]:wrap-anywhere [&_p:last-child]:mb-0";
export const quoteHead = "flex items-center justify-between gap-4 mb-[14px]";
export const quoteName = "text-[13px] font-medium tracking-[0.06em] uppercase text-muted";
export const cite =
  "mt-4 mb-0 mx-0 overflow-x-auto font-[family-name:var(--ff-mono),ui-monospace,monospace] text-[13.5px] leading-[1.6] text-(--ink) whitespace-pre";
export const copy =
  "py-[5px] px-[11px] rounded-md border border-(--rule) bg-transparent font-[inherit] text-[13px] font-medium text-(--ink) cursor-pointer touch-manipulation transition-[border-color] duration-micro ease-enter hover:border-(--ink) pointer-coarse:relative pointer-coarse:after:absolute pointer-coarse:after:-inset-y-[9px] pointer-coarse:after:inset-x-0";

/* Colophon */

export const colophon = "pt-12 pb-18 text-[15px] text-muted";
export const colophonLinks = "flex flex-wrap gap-y-2 gap-x-6 [&_a]:pointer-coarse:inline-flex [&_a]:pointer-coarse:items-center [&_a]:pointer-coarse:min-w-11 [&_a]:pointer-coarse:min-h-11";
