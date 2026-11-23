import * as ui from "@/components/ui/styles";

/** The loan page: head, the risk panel with the health meter, the figures, the action tabs and the side column. */

export const col = "flex flex-col gap-10 max-md:gap-8";
export const head =
  "flex flex-col gap-3 [&_h1]:text-[length:clamp(40px,4.6vw,68px)] [&_h1]:font-semibold [&_h1]:tracking-[-0.035em] [&_h1]:leading-[1.02]";
/** The page title when it is not an `h1`, as in the skeleton. */
export const h1 = "text-[length:clamp(40px,4.6vw,68px)] font-semibold tracking-[-0.035em] leading-[1.02]";
export const title = "flex items-center flex-wrap gap-y-3 gap-x-5";
export const sub = "text-[length:clamp(18px,1.5vw,21px)] text-body [&_.mono]:text-heading";
export const h2 = "text-[21px] font-semibold tracking-[-0.014em] leading-[1.25]";

/** The page grid; --ln-areas and --ln-rows come from the component, and below 1024px it stacks in a fixed order. */
export const grid =
  "group/lngrid grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] [grid-template-areas:var(--ln-areas)] [grid-template-rows:var(--ln-rows,none)] gap-y-4 gap-x-12 lg:max-xl:gap-x-8 [align-items:start] max-lg:grid-cols-[minmax(0,1fr)] max-lg:[grid-template-areas:'risk'_'nums'_'notes'_'acts'_'side'] max-lg:[grid-template-rows:none] max-lg:gap-4";

const SLAB = "pt-12 pr-10 pb-10 pl-14 lg:max-xl:pr-7 lg:max-xl:pb-8 lg:max-xl:pl-12 max-md:pt-14 max-md:px-4 max-md:pb-7 bg-surface";
export const risk = ui.cx("[grid-area:risk] min-w-0", SLAB);
export const closed = "[grid-area:risk] min-w-0";
export const liq = "mt-[18px] max-w-[52ch] text-[16px] text-body [&_b]:text-heading [&_b]:font-semibold [&_.mono]:text-heading [&_p]:text-body";

export const nums =
  "[grid-area:nums] grid gap-1 self-stretch content-stretch m-0 [&>div]:flex [&>div]:flex-col [&>div]:justify-center [&>div]:gap-1 [&>div]:min-w-0 [&>div]:py-[18px] [&>div]:px-[22px] [&>div]:bg-[color-mix(in_oklab,var(--heading)_6%,var(--bg))] [&_dt]:text-[15px] [&_dt]:text-body [&_dd]:m-0 [&_dd]:text-heading [&_dd]:font-[family-name:var(--ff-mono),ui-monospace,monospace] [&_dd]:tabular-nums [&_dd]:text-[length:clamp(20px,1.7vw,26px)] [&_dd]:leading-[1.3] [&_dd]:wrap-anywhere [&_dd_small]:inline-block [&_dd_small]:ml-2 max-md:[&_dd_small]:block max-md:[&_dd_small]:ml-0 [&_dd_small]:text-[15px] [&_dd_small]:text-muted [&_dd_small_.mono]:text-muted";
export const notes = "[grid-area:notes] flex flex-col gap-3 min-w-0";
export const actions =
  "[grid-area:acts] flex flex-col gap-3 min-w-0 mt-6 group-data-[risk=false]/lngrid:mt-2 max-lg:mt-4 max-lg:group-data-[risk=false]/lngrid:mt-2";
export const side =
  "[grid-area:side] flex flex-col gap-10 min-w-0 mt-6 group-data-[side=top]/lngrid:mt-0 max-lg:mt-4 max-lg:group-data-[side=top]/lngrid:mt-4";

export const reasons = "flex flex-col gap-0.5 p-0 list-none text-[15px] text-muted";
export const panel = "p-6 max-md:p-5 bg-surface";
/** The panel under the action tabs: a form panel whose gold buttons line their parallelogram up with the edge. */
export const actPanel = ui.cx(panel, "mt-1 p-8 max-md:py-6 max-md:px-4", ui.panelVars, "[--hint-figure:var(--heading)] [--gold-inset:-7px]");
export const presetsInPanel = "-ml-[5px]";
export const max = "-mr-0.5";
export const after =
  "min-h-[52px] py-[14px] px-[18px] bg-[color-mix(in_oklab,var(--heading)_6%,var(--bg))] text-[15px] text-body empty:hidden [&_b]:text-heading [&_b]:font-medium";

/* Health: the ratio in large figures and the bullet meter on a 100% to 250% scale */

type Tone = "positive" | "info" | "warning" | "danger" | "neutral";

const BIG = "[&_b]:text-[length:clamp(64px,7.4vw,112px)] [&_b]:font-normal [&_b]:tracking-[-0.05em]";
const RATIO_TONE: Record<Tone, string> = {
  neutral:
    "[&_b]:font-[family-name:var(--font-sans)] [&_b]:text-[length:clamp(40px,4.6vw,64px)] [&_b]:font-medium [&_b]:tracking-[-0.03em]",
  positive: `${BIG} [&>span]:text-positive`,
  info: `${BIG} [&>span]:text-info`,
  warning: `${BIG} [&>span]:text-warning`,
  danger: `${BIG} [&>span]:text-danger`,
};

/** The ratio figure; without a tone (the skeleton) the status word keeps the text colour. */
export function ratio(tone?: Tone): string {
  return ui.cx(
    "ln-ratio flex items-baseline flex-wrap gap-y-1 gap-x-[18px] [&_b]:leading-[0.95] [&_b]:text-heading [&>span]:inline-flex [&>span]:items-center [&>span]:gap-2 [&>span]:text-[21px] [&>span]:font-medium [&>span]:leading-[1.2] [&>span>i]:w-[7px] [&>span>i]:h-3 [&>span>i]:bg-current [&>span>i]:-skew-x-16 [&>span>i]:flex-none",
    tone ? RATIO_TONE[tone] : BIG,
  );
}

const FILL: Record<Tone, string> = {
  positive: "[--bm-fill:var(--positive)]",
  neutral: "[--bm-fill:var(--positive)]",
  info: "[--bm-fill:var(--info)]",
  warning: "[--bm-fill:var(--warning)]",
  danger: "[--bm-fill:var(--danger)]",
};
export function meter(tone: Tone): string {
  return ui.cx("ln-bm", FILL[tone]);
}
export const meterScale = "relative pt-2";
export const meterTrack = "relative h-3 rounded-[6px] bg-deep overflow-hidden";
/** The fill grows in when its panel sweeps in (the `wz-open` entrance). */
export const meterFill =
  "absolute inset-y-0 left-0 right-auto w-(--at) bg-(--bm-fill) origin-left transition-[width] duration-element ease-enter motion-reduce:transition-none in-[.wz-open]:motion-safe:animate-ln-grow";
export const meterTick = "absolute top-0 bottom-0 w-0.5 -ml-px bg-surface";
export const meterBands = "relative h-1 mt-1.5";

export type Zone = "danger" | "warning" | "info" | "positive";
const ZONE: Record<Zone, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  info: "bg-info/50",
  positive: "bg-positive/55",
};
/** A band under the track; grey until the ratio is known. */
export function meterZone(zone: Zone, known: boolean): string {
  return ui.cx("absolute top-0 bottom-0", known ? ZONE[zone] : "bg-deep");
}
export const meterMarker =
  "absolute top-0 w-4 h-7 -ml-2 left-(--at) bg-mark [clip-path:polygon(calc(28px*var(--shear))_0,100%_0,calc(100%-28px*var(--shear))_100%,0_100%)] transition-[left] duration-element ease-enter motion-reduce:transition-none in-[.wz-open]:motion-safe:animate-ln-drop";
export const meterPreview =
  "absolute top-0 w-4 h-7 -ml-2 text-heading transition-[left] duration-element ease-enter motion-reduce:transition-none [&_svg]:block [&_svg]:size-full [&_svg]:overflow-visible";
export const meterTicks =
  "relative h-6 mt-0.5 [&_span]:absolute [&_span]:top-0 [&_span]:pt-2 [&_span]:[transform:translateX(-50%)] [&_span]:font-[family-name:var(--ff-mono),ui-monospace,monospace] [&_span]:text-[13px] [&_span]:leading-none [&_span]:text-muted [&_span]:whitespace-nowrap";
export const meterLegend =
  "flex flex-wrap gap-y-1.5 gap-x-5 mt-2 p-0 list-none text-[13px] leading-[1.6] text-muted [&_li]:inline-flex [&_li]:items-center [&_li]:gap-2";
export function legendKey(zone: Zone): string {
  return ui.cx("w-[14px] h-1", ZONE[zone]);
}

/* Your way out and On this device */

export const out = "pt-12 pr-8 pb-8 pl-12 max-md:pt-14 max-md:px-4 max-md:pb-7 bg-deep";
export const outText = "mt-3 text-[19px] leading-normal text-heading";
export const outTrack =
  "relative h-2 mt-5 rounded-[4px] bg-tint-20 overflow-hidden [&_b]:absolute [&_b]:inset-y-0 [&_b]:left-0 [&_b]:right-auto [&_b]:w-(--at) [&_b]:rounded-[4px] [&_b]:bg-heading [&_span]:absolute [&_span]:top-0 [&_span]:right-0 [&_span]:bottom-0 [&_span]:w-1.5 [&_span]:rounded-[0_4px_4px_0] [&_span]:bg-mark";
export const outEnds = "flex justify-between gap-3 mt-2 text-[13px] text-muted [&_.mono]:text-heading";
export const device = "flex flex-col gap-2";
export const deviceText = "text-[16px]";
export const deviceNote = ui.cx(ui.muted, "text-[15px]");
export const txs = "flex flex-col gap-1 my-1 p-0 list-none";
export const tx =
  "flex flex-wrap items-center gap-y-1.5 gap-x-[14px] min-h-[52px] py-2.5 px-4 bg-[color-mix(in_oklab,var(--heading)_6%,var(--bg))] text-[14px] [&_b]:text-heading [&_b]:font-medium";
export const txChip = "inline-flex items-center gap-1.5 text-[13px] text-muted data-[state=pending]:text-info data-[state=done]:text-positive";
export const txEnd = "flex gap-[14px] items-center ml-auto max-md:ml-0 text-muted";

export const empty = ui.cx("flex flex-col items-start gap-4 max-w-[720px]", "pt-12 pr-10 pb-10 pl-14 max-md:pt-14 max-md:px-4 max-md:pb-7 bg-surface");

/* Borrow: the liquidation estimate and the receive-as options */

export const est = "m-0 [&_dd_small]:block [&_dd_small]:text-muted";
export const receiveOption = ui.cx(
  ui.chip,
  "flex-col items-start gap-0.5 min-h-14 py-1.5 px-[22px] whitespace-normal text-left [&_small]:text-[13px] [&_small]:font-normal [&_small]:text-muted [&[aria-pressed=true]_small]:text-deep",
);

/* The full-cycle timeline */

export const timeline = "grid gap-3";
export const timelineList =
  "grid gap-0 m-0 p-0 list-none [&_li]:relative [&_li]:grid [&_li]:grid-cols-[16px_minmax(0,1fr)] [&_li]:gap-3 [&_li]:pb-4 [&_li]:before:absolute [&_li]:before:top-[18px] [&_li]:before:bottom-0 [&_li]:before:left-[7px] [&_li]:before:w-0.5 [&_li]:before:bg-line-strong [&_li:last-child]:before:hidden [&_li>i]:size-4 [&_li>i]:mt-[3px] [&_li>i]:rounded-[50%] [&_li>i]:[box-shadow:inset_0_0_0_2px_var(--line-strong)] [&_li[data-state=done]>i]:bg-positive [&_li[data-state=done]>i]:[box-shadow:none] [&_b]:block [&_b]:text-[15px] [&_b]:font-semibold [&_b]:text-heading [&_li[data-state=next]_b]:font-medium [&_li[data-state=next]_b]:text-muted";
export const timelineMeta = "flex flex-wrap gap-y-1 gap-x-3 text-[13px] text-muted";
export const timelineNote = "text-[13px]";
