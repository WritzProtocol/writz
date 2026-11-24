import * as ui from "@/components/ui/styles";

/** The deposit journey: one question per screen, with its summary, panels, asides and the lock slab. */

/** The journey's root; --bj-well is the quiet fill of rows inside a panel. */
export const root =
  "[--bj-well:color-mix(in_oklab,var(--heading)_6%,var(--bg))] [&_[data-slot=actions]>.slant:first-child]:-ml-[7px]";

export const progress = "grid grid-cols-[repeat(var(--bj-steps,6),1fr)] gap-1 h-[10px] px-0.5";
export const progressCell = "relative bg-tint-20 -skew-x-16 overflow-hidden";
/** The fill of one progress cell; `on` for steps done or current. */
export function progressFill(on: boolean): string {
  return ui.cx(
    "absolute inset-0 bg-mark origin-left transition-[transform] duration-section ease-enter motion-reduce:transition-none",
    on ? "[transform:scaleX(1)]" : "[transform:scaleX(0)]",
  );
}

export const stepline =
  "flex justify-between items-center gap-4 min-h-11 mt-[10px] [&_p]:text-[15px] [&_p]:text-body [&_b]:mr-2 [&_b]:font-semibold [&_b]:text-heading";

/* The collapsed loan summary above each question */

export const sum = "mt-7 max-md:mt-6 bg-surface";
export const sumBar = "flex items-center gap-4 py-4 pr-4 pl-6 max-md:gap-2 max-md:py-3 max-md:pr-2 max-md:pl-4 max-[381px]:flex-wrap";
export const sumVals =
  "flex flex-wrap gap-y-2 gap-x-10 max-md:gap-y-1 max-md:gap-x-5 min-w-0 [&>span]:grid [&_small]:text-[14px] [&_small]:text-muted [&_.mono]:text-[17px] max-md:[&_.mono]:text-[15px] [&_.mono]:font-medium [&_.mono]:text-heading";
export const sumCtl = "flex items-center gap-1 ml-auto flex-none";
export const toggle =
  "grid place-items-center size-11 p-0 border-none bg-transparent text-muted cursor-pointer hover:text-heading focus-visible:outline-2 focus-visible:outline-mark focus-visible:outline-offset-[-2px]";
export const caret =
  "w-2 h-2 -mt-1 data-[open=true]:mt-1 border-r-2 border-b-2 border-current [transform:rotate(45deg)] data-[open=true]:[transform:rotate(-135deg)] transition-[transform] duration-element ease-enter motion-reduce:transition-none";
export const sumBody =
  "grid gap-1 pt-0 px-4 pb-4 max-md:px-2 max-md:pb-3 [&>div]:flex [&>div]:flex-wrap [&>div]:justify-between [&>div]:items-center [&>div]:gap-y-1 [&>div]:gap-x-4 [&>div]:min-h-[52px] [&>div]:py-1 [&>div]:px-4 [&>div]:bg-(--bj-well) [&>div]:text-[15px] [&_dt]:text-muted [&_dd]:flex [&_dd]:flex-wrap [&_dd]:items-center [&_dd]:justify-end [&_dd]:gap-y-1 [&_dd]:gap-x-3 [&_dd]:min-w-0 [&_dd]:ml-auto [&_dd]:text-heading [&_dd]:text-right";

/* The question, its lead and the grid under it */

export const question =
  "mt-14 max-md:mt-9 text-[length:clamp(34px,4.4vw,64px)] font-semibold tracking-[-0.035em] leading-[1.04] text-balance";
export const lead = "max-w-[60ch] text-[17px] text-body";
export const grid =
  "group/grid grid gap-10 mt-10 max-md:mt-7 [align-items:start] min-[1200px]:data-[aside=true]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] min-[1200px]:data-[aside=true]:gap-12";
export const col = "flex flex-col gap-4 min-w-0 max-w-[720px] group-data-[aside=true]/grid:max-w-none";
export const aside = "min-[1200px]:sticky min-[1200px]:top-[100px]";

/* Panels, rows and the parts inside them */

export const panel = ui.cx("flex flex-col gap-3 p-8 max-md:py-6 max-md:px-4 bg-surface", ui.panelVars);
/** A hint in the journey; its links grow to a 44px tap area on touch screens. */
export const hint = ui.cx(ui.hint, "pointer-coarse:[&_a]:inline-flex pointer-coarse:[&_a]:items-center pointer-coarse:[&_a]:min-h-11");

/** A row of actions whose first filled button lines its parallelogram up with the panel edge. */
export const actions = ui.cx(ui.actions, "[&>.slant:first-child]:-ml-[7px]");

export const kv =
  "grid gap-1 mt-2 [&>div]:flex [&>div]:flex-wrap [&>div]:justify-between [&>div]:items-baseline [&>div]:gap-y-1 [&>div]:gap-x-4 [&>div]:py-4 [&>div]:px-5 [&>div]:bg-(--bj-well) [&_dt]:text-[15px] [&_dt]:text-body [&_dd]:m-0 [&_dd]:ml-auto [&_dd]:text-heading [&_dd]:text-right [&_dd_small]:block [&_dd_small]:text-[13px] [&_dd_small]:text-muted";
export const submit = "mt-3 -ml-[7px]";

export const rows =
  "grid gap-1 m-0 [&>div]:grid [&>div]:grid-cols-[200px_minmax(0,1fr)] max-md:[&>div]:grid-cols-[minmax(0,1fr)] [&>div]:gap-y-1.5 [&>div]:gap-x-6 [&>div]:py-5 [&>div]:px-6 max-md:[&>div]:p-4 [&>div]:bg-surface [&_dt]:pt-0.5 [&_dt]:text-[15px] [&_dt]:text-muted [&_dd]:min-w-0 [&_dd]:m-0 [&_dd]:text-[16px] [&_dd]:text-heading [&_dd_small]:block [&_dd_small]:mt-0.5 [&_dd_small]:text-[14px] [&_dd_small]:text-body";
export const big = "text-[22px]";
export const addr = "block text-[14px] leading-normal text-heading wrap-anywhere";
export const tools = "flex flex-wrap items-center gap-y-1 gap-x-4 mt-3 -ml-1.5";
export const more = "group/more [&_p]:max-w-[52ch] [&_p]:mt-1 [&_p]:text-[15px] [&_p]:text-body";
export const moreSummary =
  "inline-flex items-center gap-2 min-h-11 text-link font-medium [list-style:none] cursor-pointer [&::-webkit-details-marker]:hidden before:w-1.5 before:h-3 before:bg-current before:[transform:skewX(-16deg)] group-open/more:before:[transform:skewX(-16deg)_rotate(90deg)] before:transition-[transform] before:duration-element before:ease-enter motion-reduce:before:transition-none";

/* What you'll need, and the lock aside */

const H2 = "[&_h2]:text-[21px] [&_h2]:font-semibold [&_h2]:tracking-[-0.014em]";
export const need = ui.cx("p-6 max-md:py-6 max-md:px-4 bg-surface", H2);
export const ticks =
  "grid gap-1 mt-5 p-0 list-none [&_li]:grid [&_li]:grid-cols-[auto_minmax(0,1fr)] [&_li]:gap-y-0.5 [&_li]:gap-x-[14px] [&_li]:py-[14px] [&_li]:px-4 [&_li]:bg-(--bj-well) [&_li]:text-[15px] [&_li]:leading-normal [&_li>i]:[grid-row:span_2] [&_li>i]:w-2 [&_li>i]:h-[15px] [&_li>i]:mt-1 [&_li>i]:bg-mark [&_li>i]:-skew-x-16 [&_b]:text-[16px] [&_b]:font-semibold [&_b]:text-heading";
const SLAB =
  "pt-16 pr-8 pb-8 pl-12 [clip-path:polygon(40px_0,100%_0,100%_100%,0_100%,0_calc(40px/var(--shear)))] max-[1200px]:hidden [&_h2]:text-on-accent [&>p]:mt-2 [&>p]:text-[15px] [&>p]:text-on-accent";
export const slab = ui.cx(SLAB, H2, "bg-accent text-on-accent");
export const slabSkeleton = ui.cx(SLAB, H2, "bg-surface text-on-accent");
export const frag =
  "mt-6 p-6 bg-surface text-body [&>span]:text-[14px] [&>span]:text-muted [&>p]:mt-1 [&>p]:text-[28px] [&>p]:leading-[1.15] [&>p]:text-heading [&_li:first-child>i]:bg-muted";

/* Review: the key line, acknowledgement and slide */

export const send = "flex flex-col gap-0";
export const sendHint = ui.cx(hint, "mt-3");
export const sendNote = "mt-3 first:mt-0";
export const key =
  "flex gap-[14px] mt-3 text-[16px] text-heading [&>i]:w-2 [&>i]:h-[15px] [&>i]:mt-[5px] [&>i]:bg-mark [&>i]:-skew-x-16 [&>i]:flex-none";
export const sendCheck = ui.cx(ui.check, "mt-5 py-3 text-[16px] text-body");
export const slideTrack = "max-w-none mt-5 bg-surface not-data-[armed=true]:[box-shadow:none]";
export const slideLabel = "right-6 left-[88px] text-[16px] max-[381px]:right-3 max-[381px]:left-20 max-[381px]:text-[15px]";

/* Wallets, waits and progress rows */

export const wallet = ui.cx(ui.wallet, "gap-4 py-5 px-6 max-md:p-4 bg-surface [box-shadow:none] [&_b]:text-[17px] [&_small]:text-[14px]");
export const walletIcon = ui.cx(ui.walletIcon, "size-10 bg-surface-2 text-[17px]");
export const status = ui.cx(ui.status, "py-4 px-5 bg-surface [box-shadow:none]");
export const steps = ui.cx(
  ui.steps,
  "gap-1 [&_li]:min-h-14 [&_li]:py-[14px] [&_li]:px-5 [&_li]:bg-surface pointer-coarse:[&_a]:inline-flex pointer-coarse:[&_a]:items-center pointer-coarse:[&_a]:min-h-11",
);
export const count =
  "flex items-baseline gap-1 mt-0 mb-2 text-[length:clamp(64px,7.4vw,112px)] font-medium leading-[0.95] tracking-[-0.05em] text-heading [&_span]:text-[0.4em] [&_span]:tracking-[-0.02em] [&_span]:text-muted";

/* Done and unavailable */

/** The last panel; its links grow to a 44px tap area on touch screens. */
export const end =
  "max-w-[720px] pt-16 px-12 pb-12 max-md:pt-14 max-md:px-4 max-md:pb-8 bg-surface [&_p]:text-[17px] pointer-coarse:[&_a:not(.slant)]:inline-flex pointer-coarse:[&_a:not(.slant)]:items-center pointer-coarse:[&_a:not(.slant)]:min-h-11";
export const endStack = ui.cx(ui.stack, "gap-5");
export const endQuestion = ui.cx(question, "mt-0 max-md:mt-0 text-[length:clamp(32px,3.6vw,52px)]");
