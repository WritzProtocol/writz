import * as ui from "@/components/ui/styles";

/** Earn and Lend, and the page frame that Protocol and Reclaim share: a big hero figure, tiles, risk notes and the action column. */

export const page = "flex flex-col pt-4 max-md:pt-2";
export const h1 = "text-[length:clamp(44px,6.2vw,92px)] font-semibold tracking-[-0.04em] leading-none text-balance";
export const lede = "mt-4 max-w-[56ch] text-[length:clamp(18px,1.5vw,21px)] leading-[1.45] text-body text-pretty";
export const stale = "mt-8 max-w-[760px]";

export const grid =
  "grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-y-4 gap-x-12 mt-12 [align-items:start] max-xl:grid-cols-[minmax(0,1fr)] max-xl:gap-8 max-xl:mt-10 max-md:mt-8 max-md:gap-6";
export const figures = "min-w-0";
/** The action column; its notices are a little roomier than elsewhere. */
export const act = "flex flex-col gap-4 min-w-0 max-xl:max-w-[640px] [--note-py:18px] [--note-px:20px] [--note-size:15px]";

/* The hero: one figure sized to its container, so long amounts still fit */

export const hero = "@container pt-16 pr-12 pb-12 pl-16 max-md:pt-16 max-md:px-4 max-md:pb-7 bg-surface";
export const heroKey = "text-[16px] text-body";
export const big = "flex items-baseline flex-wrap gap-y-1 gap-x-[14px] mt-2 mb-0 mx-0";
export const bigFigure =
  "text-[length:clamp(40px,calc((100cqi_-_var(--u,4)_*_11.4px_-_16px)_/_(var(--n,8)_*_0.58)),96px)] font-normal leading-none tracking-[-0.045em] text-heading";
export const bigUnit = "font-[family-name:var(--ff-mono),ui-monospace,monospace] text-[19px] font-medium leading-none text-body";
export const bigSkeleton = "inline-block w-[min(100%,360px)] h-20 align-middle";
export const bigNa = "text-[28px] text-muted";

const CAPTION = "m-0 text-[14px] leading-[1.45] text-muted";
export const heroCaption = ui.cx(CAPTION, "mt-3");

/* Tiles under the hero */

export const tiles =
  "grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] max-md:grid-cols-[minmax(0,1fr)] gap-1 mt-1 mb-0 mx-0 [&>div]:flex [&>div]:flex-col [&>div]:gap-1.5 [&>div]:min-w-0 [&>div]:py-[22px] [&>div]:px-6 [&>div]:bg-[color-mix(in_oklab,var(--heading)_6%,var(--bg))] max-md:[&>div]:flex-row max-md:[&>div]:flex-wrap max-md:[&>div]:justify-between max-md:[&>div]:items-baseline max-md:[&>div]:gap-y-1 max-md:[&>div]:gap-x-3 max-md:[&>div]:p-4 max-md:max-[360px]:[&>div]:flex-col max-md:max-[360px]:[&>div]:flex-nowrap max-md:max-[360px]:[&>div]:items-stretch [&_dt]:text-[15px] [&_dt]:text-body";
export const tileValue =
  "m-0 flex items-baseline flex-wrap gap-y-0.5 gap-x-2.5 text-heading max-md:justify-end max-md:ml-auto max-md:text-right max-md:max-[360px]:justify-start max-md:max-[360px]:ml-0 max-md:max-[360px]:text-left";
export const tileFigure = "text-[length:clamp(20px,1.8vw,26px)] max-md:text-[18px] leading-[1.2] wrap-anywhere";
export const tileUnit = "font-[family-name:var(--ff-mono),ui-monospace,monospace] text-[length:clamp(20px,1.8vw,26px)] max-md:text-[18px] leading-[1.2]";
export const tileNa = "text-[17px] text-muted";
export const tileSkeleton = "inline-block w-[140px] h-7 align-middle";
export const tileCaption = ui.cx(CAPTION, "max-md:basis-full max-md:max-[360px]:basis-auto");

/* Risk notes and the text links under them */

export const risk =
  "flex flex-col items-start gap-[10px] mt-8 max-w-[60ch] [&_p]:flex [&_p]:gap-[14px] [&_p]:text-[16px] [&_p]:leading-[1.55] [&_p]:text-heading [&_p]:before:w-2 [&_p]:before:h-[15px] [&_p]:before:mt-[5px] [&_p]:before:bg-mark [&_p]:before:-skew-x-16 [&_p]:before:flex-none";
/** A text link with a 44px tap area; a second one right after the first sits closer. */
export const textLink = ui.cx(ui.link, "[--link-display:inline-flex] [--link-align:center] [--link-min-h:44px] font-medium underline-offset-[0.22em] [:not(p)+&]:-mt-[10px]");

/* The action panel */

export const seg = "grid-cols-[repeat(2,minmax(0,1fr))]";
/** A form panel: labels in sentence case, and its links grow to 44px tap targets. */
export const panel =
  "p-8 max-md:py-6 max-md:px-4 bg-surface [--label-size:15px] [--label-tracking:0] [--label-case:none] [--label-color:var(--heading)] [--link-display:inline-flex] [--link-align:center] [--link-min-h:44px]";
/** The submit row of a panel form, lined up with the panel edge. */
export const panelActions = ui.cx(ui.actions, "mt-2 -ml-[7px]");
