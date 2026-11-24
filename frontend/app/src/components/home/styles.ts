import * as ui from "@/components/ui/styles";

/** Home: the headline, loan cards, the deposit in progress, the preview for a first visit, and the guided first loan. */

/** The page column. Notices placed straight in it are larger than elsewhere. */
export const col =
  "flex flex-col gap-6 max-[761px]:gap-5 [&>[data-tone]]:gap-[10px] [&>[data-tone]]:[--note-py:20px] [&>[data-tone]]:[--note-px:24px] [&>[data-tone]]:[--note-size:16px] [&>[data-tone]>span:first-child]:text-[14px]";
export const head = "flex flex-col gap-[10px]";
export const h1 = "text-[40px] max-[761px]:text-[30px] font-semibold tracking-[-0.025em] leading-[1.1] text-balance";
/** The headline in large display type. */
export const display = "text-[length:clamp(44px,6.2vw,92px)] max-[761px]:text-[30px] font-semibold tracking-[-0.04em] leading-none text-balance";
export const sub = "max-w-[640px] text-[17px] max-[761px]:text-[16px] text-body";
export const h2 = "text-[20px] font-semibold tracking-[-0.01em]";
export const h3 = "text-[17px] font-semibold";
export const section = "flex flex-col gap-[14px]";
export const card = "flex flex-col gap-4 pt-10 pr-8 pb-8 pl-12 max-[761px]:pt-10 max-[761px]:pr-4 max-[761px]:pb-6 max-[761px]:pl-6 bg-surface min-w-0";
export const grid = "grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))]";
export const guard = "flex flex-col gap-3 py-12";

/* Loan cards */

/**
 * The loans list. Several loans sit in a grid; a single loan bleeds to the right edge of the window from 768px
 * (`data-bleed` also clips the page's horizontal overflow, see globals.css).
 */
export const loans =
  "grid gap-4 [&:not([data-count='1'])]:grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] [&[data-count='1']>*]:mr-[calc(-1_*_(100vw_-_var(--hm-rail,0px)_-_min(100vw_-_var(--hm-rail,0px),_1184px_+_2_*_var(--gut)))_/_2_-_var(--gut))] max-md:[&[data-count='1']>*]:mr-0";
/** The loans list placed straight in the page column. */
export const loansInCol = "mt-4";

export function loan(compact: boolean): string {
  return ui.cx(
    "relative grid min-w-0 bg-surface max-[761px]:gap-8 max-[761px]:pt-16 max-[761px]:px-4 max-[761px]:pb-8",
    compact
      ? "grid-cols-[minmax(0,1fr)] gap-7 pt-12 pr-8 pb-8 pl-12"
      : "grid-cols-[minmax(0,7fr)_minmax(0,5fr)] max-xl:grid-cols-[minmax(0,1fr)] gap-16 max-xl:gap-10 max-xl:max-[761px]:gap-8 pt-14 pr-14 pb-14 pl-[72px]",
  );
}
export const loanMain = "flex flex-col min-w-0";
export const loanSide = "flex flex-col min-w-0 gap-7";
export function loanHead(compact: boolean): string {
  return ui.cx(
    "flex items-center flex-wrap gap-y-3 gap-x-4 [&_h2]:text-[length:clamp(21px,1.8vw,25px)] [&_h2]:font-semibold [&_h2]:tracking-[-0.014em] [&_h2]:leading-[1.25]",
    compact ? "mb-5" : "mb-7",
  );
}
export const loanNote = "text-[15px] text-body";
export const liq = "mt-5 max-w-[52ch] text-[16px] text-body [&_b]:font-semibold [&_b]:text-heading [&_.mono]:text-heading";
export function kv(compact: boolean): string {
  return ui.cx(
    "grid gap-1 m-0 [&>div]:flex [&>div]:justify-between [&>div]:items-baseline [&>div]:flex-wrap [&>div]:gap-y-1 [&>div]:gap-x-4 [&>div]:py-4 [&>div]:px-5 max-[761px]:[&>div]:py-[14px] max-[761px]:[&>div]:px-4 [&>div]:bg-[color-mix(in_oklab,var(--heading)_6%,var(--bg))] [&_dt]:text-[15px] [&_dt]:text-body [&_dd]:m-0 [&_dd]:ml-auto [&_dd]:text-heading [&_dd]:text-right",
    compact ? "[&_dd]:text-[19px]" : "[&_dd]:text-[length:clamp(19px,1.6vw,24px)]",
  );
}
/** The card's actions; the link to the loan stretches over the whole card, under the buttons. */
export const loanActs = "flex items-center flex-wrap gap-y-2 gap-x-5 mt-auto -ml-[7px]";
export const loanAct = "z-1";
export const stretch = ui.cx(ui.btn("text"), "ml-[7px] static [scale:none] active:[scale:none] after:absolute after:inset-0");

export const big = "text-[28px] text-heading [&_span]:text-[16px] [&_span]:text-muted";
export const slots = "max-w-[560px]";

/* First visit: the preview, what you need and how a loan works */

export const preview = "grid gap-6 grid-cols-[minmax(0,560px)_minmax(0,1fr)] max-[901px]:grid-cols-[minmax(0,1fr)] [align-items:start]";
export const previewLine = "text-[18px] text-heading [&_b]:font-medium";
export const need = "flex flex-col gap-1 pt-6 max-[901px]:pt-0";
export const needList = "mt-3";
export const needLink = "self-start mt-2";
export const how = "flex flex-col gap-[18px] pt-6";
export const steps =
  "grid grid-cols-[repeat(3,minmax(0,1fr))] max-[901px]:grid-cols-[minmax(0,1fr)] gap-6 m-0 p-0 list-none [&_li]:flex [&_li]:gap-[14px] [&_li]:items-start [&_p]:mt-1 [&_p]:text-[15px]";
export const stepN =
  "relative isolate grid place-items-center size-11 text-accent font-semibold flex-none font-[family-name:var(--ff-mono),ui-monospace,monospace] before:absolute before:inset-y-0 before:inset-x-1.5 before:-z-1 before:bg-surface before:-skew-x-16";
export const wayout = "text-[15px] [&_b]:text-heading [&_b]:font-medium";
export const closed = "group/closed";
export const closedSummary = "min-h-11 flex items-center text-heading font-medium cursor-pointer group-open/closed:mb-2";
export const foot = "flex flex-wrap gap-y-2 gap-x-7 mt-10";
export const footLink = ui.cx(ui.btn("text"), "pointer-coarse:min-w-11 text-body decoration-body/45 hover:text-heading hover:decoration-current");

/* The guided first loan */

export const guide = ui.cx(card, "gap-5 max-[601px]:pt-7 max-[601px]:px-5 max-[601px]:pb-6");
export const guideHead = "flex flex-col gap-1.5";
export const guideSteps =
  "flex flex-col m-0 p-0 list-none [&>li]:flex [&>li]:gap-4 [&>li]:items-start [&>li]:py-4 [&>li]:border-t [&>li]:border-line [&>li:first-child]:border-t-0 [&>li:first-child]:pt-1";

type StepState = "now" | "done" | "next";
const GUIDE_N: Record<StepState, string> = {
  now: "text-on-accent before:bg-accent",
  done: "text-heading before:bg-[color-mix(in_oklab,var(--positive)_45%,var(--deep))]",
  next: "text-muted before:bg-deep",
};
export function guideN(state: StepState): string {
  return ui.cx(
    "relative isolate grid place-items-center w-10 h-8 flex-none font-semibold text-[15px] before:absolute before:inset-y-0 before:inset-x-[5px] before:-z-1 before:-skew-x-16",
    GUIDE_N[state],
  );
}
export const guideBody = "flex flex-col gap-[10px] min-w-0 pt-[5px] text-[15px] text-body";
const GUIDE_TITLE: Record<StepState, string> = {
  now: "text-heading font-semibold",
  done: "text-body font-medium",
  next: "text-muted font-medium",
};
export function guideTitle(state: StepState): string {
  return ui.cx("text-[16px]", GUIDE_TITLE[state]);
}
export const guideFail = "flex flex-col gap-[10px] [&_b]:text-heading [&_b]:font-semibold";
