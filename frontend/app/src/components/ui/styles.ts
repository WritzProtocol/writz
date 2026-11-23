/**
 * The shared primitives of the app as Tailwind class strings.
 *
 * Two utilities that set the same property on one element do not override
 * each other by class order, so a primitive's variants never repeat a property
 * the base sets: each function assembles one complete, non-overlapping list.
 * The parallelogram fills behind buttons and chips read --slant-bg, which a
 * state variant can set without fighting the base fill.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* Buttons: parallelograms at the mark's minus 16 degrees. */

export type BtnTone = "default" | "gold" | "line" | "quiet" | "text";

const BTN =
  "wz-btn items-center justify-center border-none rounded-none bg-transparent font-medium tracking-[-0.006em] text-center cursor-pointer [-webkit-tap-highlight-color:transparent] touch-manipulation active:[scale:0.96] disabled:[scale:1] aria-disabled:[scale:1] disabled:cursor-not-allowed aria-disabled:cursor-not-allowed disabled:text-muted aria-disabled:text-muted duration-micro ease-enter motion-reduce:transition-none motion-reduce:before:transition-none";
const BTN_FILLED =
  "slant inline-flex leading-[1.2] no-underline select-none transition-[scale,color] disabled:[--slant-bg:var(--tint-10)] aria-disabled:[--slant-bg:var(--tint-10)] disabled:before:[box-shadow:none] aria-disabled:before:[box-shadow:none]";
const BTN_HOVER = "hover:not-disabled:not-aria-disabled:[--slant-bg:var(--tint-20)]";

const BTN_TONE: Record<Exclude<BtnTone, "text">, string> = {
  default: `text-heading ${BTN_HOVER}`,
  quiet: `wz-btn-quiet text-body hover:text-heading ${BTN_HOVER}`,
  gold: "wz-btn-gold text-on-accent [--slant-bg:var(--accent)] hover:not-disabled:not-aria-disabled:[--slant-bg:var(--accent-hover)]",
  line: `text-heading [--slant-bg:transparent] before:[box-shadow:inset_0_0_0_1px_var(--edge)] focus-visible:before:[box-shadow:inset_0_0_0_1px_var(--edge),0_0_0_2px_var(--bg),0_0_0_4px_var(--mark)] ${BTN_HOVER}`,
};

const BTN_TEXT =
  "wz-btn-text relative isolate p-0 text-link underline decoration-link/45 underline-offset-4 hover:decoration-current disabled:decoration-current aria-disabled:decoration-current transition-[scale,color,text-decoration-color] focus-visible:outline-2 focus-visible:outline-mark focus-visible:outline-offset-2";

/** A button or a link styled as one. `inline` sits a text button inside running copy. */
export function btn(
  tone: BtnTone = "default",
  size: "md" | "sm" = "md",
  { inline = false, gap = "gap-[10px]" }: { inline?: boolean; gap?: string } = {},
): string {
  if (tone === "text") {
    return cx(
      BTN,
      gap,
      BTN_TEXT,
      inline ? "wz-inline inline min-h-0 text-[length:inherit] leading-[inherit] whitespace-nowrap pointer-coarse:py-[13px]" : cx("inline-flex min-h-11 leading-[1.2]", size === "sm" ? "text-[15px]" : "text-[16px]"),
    );
  }
  return cx(BTN, gap, BTN_FILLED, BTN_TONE[tone], size === "sm" ? "min-h-11 px-5 text-[15px] [--slant-inset:6px]" : "min-h-12 px-7 text-[16px]");
}

/** An inline text link. */
export const link =
  "wz-link text-link underline decoration-link/45 underline-offset-3 transition-[text-decoration-color] duration-micro ease-enter motion-reduce:transition-none hover:decoration-current";

/** A link set in mono, such as a transaction id; on touch screens its tap area grows to 44px without moving the line. */
export const monoLink = cx(link, "mono pointer-coarse:py-[13px] pointer-coarse:-my-[13px]");

/* Tags, badges and the slash before a status */

const TAG =
  "relative isolate inline-flex items-center gap-2 min-h-8 px-4 text-[14px] font-medium leading-[1.2] flex-none before:absolute before:inset-y-0 before:inset-x-[5px] before:-z-1 before:bg-tint-10 before:-skew-x-16";

export const tag = `${TAG} text-body whitespace-nowrap`;

export type Tone = "info" | "positive" | "warning" | "danger" | "neutral";

const BADGE_TONE: Record<Tone, string> = {
  neutral: "text-heading [&>i]:bg-muted",
  info: "text-info [&>i]:bg-current",
  positive: "text-positive [&>i]:bg-current",
  warning: "text-warning [&>i]:bg-current",
  danger: "text-danger [&>i]:bg-current",
};

/** A status badge; its `<i>` child is the slash. */
export function badge(tone: Tone): string {
  return cx(TAG, "max-w-full whitespace-normal [&>i]:inline-block [&>i]:w-[7px] [&>i]:h-3 [&>i]:-skew-x-16 [&>i]:flex-none", BADGE_TONE[tone]);
}

/* Chips: small quiet parallelograms for presets and inline actions */

export const chips = "flex flex-wrap gap-1";

export const chip =
  "wz-chip relative isolate inline-flex items-center justify-center min-h-11 px-5 border-none bg-transparent text-heading aria-pressed:text-bg disabled:text-muted text-[15px] font-medium leading-[1.2] whitespace-nowrap cursor-pointer disabled:cursor-not-allowed flex-none [-webkit-tap-highlight-color:transparent] touch-manipulation select-none transition-[scale] duration-micro ease-enter motion-reduce:transition-none active:not-disabled:[scale:0.96] focus-visible:outline-none before:absolute before:inset-y-0 before:inset-x-[6px] before:-z-1 before:bg-tint-10 aria-pressed:before:bg-heading hover:not-disabled:not-aria-pressed:before:bg-tint-20 before:-skew-x-16 before:transition-[background-color] before:duration-micro before:ease-enter motion-reduce:before:transition-none focus-visible:before:[box-shadow:0_0_0_2px_var(--bg),0_0_0_4px_var(--mark)]";

/* Fields */

export const label = "wz-label block text-[13px] font-medium tracking-[0.06em] uppercase text-muted";

export const hint = "wz-hint text-[14px] text-muted";

export const error = "wz-error text-[14px] text-danger";

/** The box around an amount input. `sm` is the compact size used in sheets. */
export function field(size: "md" | "sm" = "md", { skeleton = false }: { skeleton?: boolean } = {}): string {
  return cx(
    skeleton ? "[box-shadow:inset_0_0_0_1px_var(--line-strong)]" : "[box-shadow:inset_0_0_0_1px_var(--muted)]",
    "wz-field flex items-center gap-2 pl-5 bg-bg focus-within:outline-2 focus-within:outline-mark focus-within:outline-offset-1 focus-within:[box-shadow:inset_0_0_0_1px_var(--heading)] data-[invalid=true]:[box-shadow:inset_0_0_0_2px_var(--danger)] transition-[box-shadow] duration-micro ease-enter motion-reduce:transition-none",
    "[&_input]:flex-1 [&_input]:min-w-0 [&_input]:border-none [&_input]:bg-transparent [&_input]:text-heading [&_input]:font-[family-name:var(--ff-mono),ui-monospace,monospace] [&_input]:tabular-nums [&_input]:outline-none [&_input]:placeholder:text-muted",
    "[&>span]:pr-3 [&>span]:font-[family-name:var(--ff-mono),ui-monospace,monospace] [&>span]:text-[15px] [&>span]:font-medium [&>span]:text-body",
    size === "sm" ? "min-h-[52px] pr-5 [&_input]:h-12 [&_input]:text-[16px]" : "min-h-16 pr-2 [&_input]:h-14 [&_input]:text-[26px] max-[761px]:[&_input]:text-[22px]",
  );
}

export const check =
  "wz-check flex gap-[14px] items-start text-[15px] text-heading cursor-pointer [&_input]:appearance-none [&_input]:grid [&_input]:place-items-center [&_input]:size-6 [&_input]:m-0 [&_input]:border [&_input]:border-muted [&_input]:bg-bg [&_input]:cursor-pointer [&_input]:flex-none [&_input:checked]:border-accent [&_input:checked]:bg-accent [&_input:checked]:after:w-[10px] [&_input:checked]:after:h-[6px] [&_input:checked]:after:border-l-2 [&_input:checked]:after:border-b-2 [&_input:checked]:after:border-on-accent [&_input:checked]:after:[transform:translateY(-2px)_rotate(-45deg)]";

/* Layout */

export const stack = "wz-stack flex flex-col gap-4";
export const actions = "wz-actions flex gap-3 flex-wrap items-center";
export const muted = "wz-muted text-muted";
export const strong = "text-heading font-medium";
export const spread = "wz-spread flex justify-between items-baseline gap-3 flex-wrap";


/* Notices: status colour at 10% tint, always with a word label after the slash */

const NOTE_TONE: Record<Tone, string> = {
  info: "bg-[color-mix(in_srgb,var(--info)_10%,transparent)] [box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--info)_35%,transparent)]",
  positive: "bg-[color-mix(in_srgb,var(--positive)_10%,transparent)] [box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--positive)_35%,transparent)]",
  warning: "bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] [box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--warning)_40%,transparent)]",
  danger: "bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] [box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--danger)_40%,transparent)]",
  neutral: "bg-bg [box-shadow:inset_0_0_0_1px_var(--line-strong)]",
};

/** A notice box; the tone sets its tint and the colour of its label. */
export function note(tone: Tone, spacing = "gap-1.5 py-[14px] px-4"): string {
  return cx(
    spacing,
    "wz-note flex flex-col text-[14px] leading-[1.45] text-heading [&_b]:font-semibold [&_p]:text-inherit [&_details]:text-[13px] [&_details]:text-muted [&_summary]:cursor-pointer [&_details_p]:font-[family-name:var(--ff-mono),ui-monospace,monospace] [&_details_p]:wrap-anywhere",
    NOTE_TONE[tone],
  );
}

const NOTE_LABEL_TONE: Record<Tone, string> = {
  info: "text-info",
  positive: "text-positive",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-heading",
};

/** The word label after the slash, at the top of a notice. */
export function noteLabel(tone: Tone): string {
  return cx(
    "wz-note-label inline-flex items-center gap-2 text-[13px] font-semibold before:w-1.5 before:h-[11px] before:bg-current before:-skew-x-16 before:flex-none",
    NOTE_LABEL_TONE[tone],
  );
}

/** A link inside a notice, which underlines a little further from the text than `link`. */
export const noteLink =
  "wz-link text-link underline decoration-link/45 underline-offset-4 transition-[text-decoration-color] duration-micro ease-enter motion-reduce:transition-none hover:decoration-current pointer-coarse:inline-flex pointer-coarse:items-center pointer-coarse:min-h-11";

/** A text button inside a notice, aligned to the start of the notice. */
export const noteTextAlign = "justify-start text-left";

/* Ledger rows: a term on the left, its value on the right */

export function row({ wrap = false }: { wrap?: boolean } = {}): string {
  return cx(
    "wz-row flex flex-wrap justify-between items-baseline gap-4 py-3 border-t border-line first:border-t-0 text-[15px] max-[360px]:flex-col max-[360px]:items-start max-[360px]:gap-0.5 [&_dt]:shrink-0 [&_dt]:text-muted [&_dd]:min-w-0 [&_dd]:m-0 [&_dd]:ml-auto [&_dd]:text-heading max-[360px]:[&_dd]:ml-0",
    wrap ? "[&_dd]:basis-full [&_dd]:text-left [&_dd]:text-[14px]" : "[&_dd]:text-right max-[360px]:[&_dd]:text-left",
  );
}

/** The list of what a step needs, each item after a gold slash. */
export const need =
  "wz-need grid gap-[10px] mt-6 p-0 list-none text-[15px] [&_li]:relative [&_li]:pl-5 [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:top-1.5 [&_li]:before:w-[7px] [&_li]:before:h-3 [&_li]:before:bg-accent [&_li]:before:-skew-x-16 [&_b]:text-heading [&_b]:font-medium";

export const well = "m-0 py-1 px-4 bg-bg [box-shadow:inset_0_0_0_1px_var(--line)]";

/* Wallet, status and step rows */

export const wallet =
  "wz-wallet flex items-center gap-[14px] py-[14px] px-4 [box-shadow:inset_0_0_0_1px_var(--line-strong)] [&>div]:min-w-0 [&_b]:block [&_b]:text-heading [&_b]:font-medium [&_small]:block [&_small]:text-muted [&_small]:text-[13px] [&_small]:wrap-anywhere";
export const walletIcon = "wz-wallet-icon grid place-items-center size-9 bg-surface-2 font-semibold text-heading flex-none";

export const status =
  "wz-status flex items-center gap-[10px] py-[14px] px-4 bg-bg [box-shadow:inset_0_0_0_1px_var(--line)] text-heading text-[15px]";

export const spin = "size-4 rounded-[50%] border-2 border-line-strong border-t-heading motion-reduce:border-t-line-strong animate-wz-spin flex-none";

export const steps =
  "wz-steps flex flex-col gap-3 p-0 list-none [&_li]:flex [&_li]:items-center [&_li]:flex-wrap [&_li]:gap-[10px] [&_li]:text-[15px] [&_li]:text-muted [&_li[data-state=done]]:text-body [&_li[data-state=now]]:text-heading [&_li>i]:size-4 [&_li>i]:rounded-[50%] [&_li>i]:[box-shadow:inset_0_0_0_2px_var(--line-strong)] [&_li>i]:flex-none [&_li[data-state=done]>i]:bg-positive [&_li[data-state=done]>i]:[box-shadow:none]";

/* Skeletons */

export const skeleton = "bg-(--sk) animate-wz-sk";
/** Placeholder text: invisible copy under a bar. */
export const skText = "text-transparent bg-(--sk) no-underline box-decoration-clone animate-wz-sk";

/** Skeleton markers of a list drawn by its own stylesheet. */
export const skList = "[&_li]:before:bg-(--sk) [&>p]:before:bg-(--sk)";
export const skCheck = "size-6 flex-none [box-shadow:inset_0_0_0_1px_var(--line-strong)]";

/* Slide to confirm: the track, also drawn empty by skeletons */

export const slide =
  "wz-slide relative h-16 max-w-[480px] bg-bg [box-shadow:inset_0_0_0_1px_var(--line-strong)] overflow-hidden select-none touch-none";

/* Headings and the done state */

export const h2 = "text-[27px] font-semibold tracking-[-0.02em]";

export const doneMark = "w-14 h-10 bg-accent [mask:url(/brand/writz-mark.svg)_no-repeat_center/contain]";

/** A connection dot: an outline, or green when `data-on` is true. */
export const dot = "w-1.5 h-[10px] [box-shadow:inset_0_0_0_1.5px_var(--muted)] -skew-x-16 flex-none data-[on=true]:bg-positive data-[on=true]:[box-shadow:none]";

/** The skeleton fill of a button's parallelogram, without its label. */
export const skFill = "pointer-events-none [--slant-bg:var(--sk)] before:[box-shadow:none] before:animate-wz-sk";

/* Segmented control: tabs on a grid, with an indicator that slides under the selected one */

export const seg = "relative isolate grid grid-flow-col auto-cols-[minmax(0,1fr)] gap-1";

export const segTab =
  "relative z-1 isolate min-h-[52px] px-3 max-[480px]:px-1 max-[360px]:px-0.5 border-none bg-transparent text-body aria-selected:text-bg aria-disabled:text-muted text-[16px] max-[480px]:text-[15px] max-[360px]:text-[14px] max-[360px]:tracking-[-0.01em] font-medium leading-[1.2] cursor-pointer aria-disabled:cursor-not-allowed touch-manipulation select-none transition-[color] duration-element ease-enter motion-reduce:transition-none motion-reduce:before:transition-none focus-visible:outline-none before:absolute before:inset-y-0 before:inset-x-2 max-[480px]:before:inset-x-1.5 max-[360px]:before:inset-x-1 before:-z-1 before:bg-tint-10 aria-selected:before:bg-transparent aria-disabled:before:bg-heading/4 hover:not-aria-selected:not-aria-disabled:before:bg-tint-20 before:-skew-x-16 before:transition-[background-color] before:duration-element before:ease-enter focus-visible:before:[box-shadow:0_0_0_2px_var(--bg),0_0_0_4px_var(--mark)]";

/** The indicator under the selected tab; the control sets --seg-n (tab count) and --seg-i (selected index). */
export const segInd =
  "absolute inset-y-0 left-0 z-0 w-[calc((100%_-_(var(--seg-n)_-_1)_*_4px)_/_var(--seg-n))] [transform:translateX(calc(var(--seg-i)_*_(100%_+_4px)))] transition-[transform] duration-element ease-enter motion-reduce:transition-none pointer-events-none before:absolute before:inset-y-0 before:inset-x-2 max-[480px]:before:inset-x-1.5 max-[360px]:before:inset-x-1 before:bg-heading before:-skew-x-16";

/* Skeleton buttons: the parallelogram at the real button's size, without the label */

const SK_BTN =
  "relative isolate inline-flex items-center justify-center border-none rounded-none bg-transparent text-transparent font-medium leading-[1.2] tracking-[-0.006em] text-center no-underline cursor-pointer [-webkit-tap-highlight-color:transparent] touch-manipulation select-none pointer-events-none active:[scale:0.96] duration-micro ease-enter motion-reduce:transition-none motion-reduce:before:transition-none focus-visible:outline-none before:absolute before:inset-y-0 before:-z-1 before:bg-(--sk) hover:before:bg-tint-20 before:-skew-x-16 before:animate-wz-sk before:duration-micro before:ease-enter focus-visible:before:[box-shadow:0_0_0_2px_var(--bg),0_0_0_4px_var(--mark)]";

const SK_KIND = {
  btn: "gap-[10px] min-h-12 px-7 text-[16px] transition-[scale,color] before:inset-x-[7px] before:transition-[background-color,box-shadow]",
  sm: "gap-[10px] min-h-11 px-5 text-[15px] transition-[scale,color] before:inset-x-1.5 before:transition-[background-color,box-shadow]",
  seg: "gap-[10px] min-h-[52px] px-3 text-[16px] transition-[scale,color] before:inset-x-2 before:transition-[background-color,box-shadow]",
  badge: "gap-2 min-h-8 px-4 text-[14px] whitespace-normal flex-none max-w-full transition-[scale,color] before:inset-x-[5px] before:transition-[background-color,box-shadow]",
  chip: "gap-[10px] min-h-11 px-5 text-[15px] whitespace-nowrap flex-none transition-[scale] before:inset-x-1.5 before:transition-[background-color]",
} as const;

export type SkKind = keyof typeof SK_KIND;

export function skBtn(kind: SkKind = "btn"): string {
  return cx(SK_BTN, SK_KIND[kind]);
}
