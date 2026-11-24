/**
 * The landing's parts as Tailwind class strings: the shared pieces (buttons, tag, slash, tick, text link, eyebrow,
 * page width), the navbar and footer, and the sections of the home page.
 */

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/* The root of a landing page: the gutter and page width, the dark ground. `landing` and `home` are hooks for globals.css. */
export const root =
  "landing [--gut:32px] max-md:[--gut:16px] [--max:1184px] [color-scheme:dark] bg-bg text-body font-sans [overflow-x:clip]";
export const homeRoot = cx(root, "home text-[17px] max-md:text-[16px] leading-[1.6]");

/* Shared pieces */

export const wrap = "w-full max-w-[calc(var(--max)+2*var(--gut))] mx-auto px-(--gut)";

const BTN =
  "relative isolate inline-flex items-center justify-center gap-[10px] border-none bg-transparent font-sans font-medium leading-none tracking-[-0.006em] whitespace-nowrap cursor-pointer [-webkit-tap-highlight-color:transparent] touch-manipulation select-none transition-[transform] duration-micro ease-enter active:[transform:scale(0.96)] motion-reduce:active:[transform:none] focus-visible:outline-none before:absolute before:inset-y-0 before:-z-1 before:-skew-x-16 before:transition-[background-color] before:duration-micro before:ease-enter focus-visible:before:[box-shadow:0_0_0_2px_var(--bg),0_0_0_4px_var(--mark)]";
const BTN_TONE = {
  default: "text-heading before:bg-tint-10 hover:before:bg-tint-20",
  gold: "text-on-accent before:bg-accent hover:before:bg-accent-hover",
};

/** A parallelogram button. `sm` is the navbar size. */
export function btn(tone: keyof typeof BTN_TONE = "default", size: "md" | "sm" = "md"): string {
  return cx(BTN, BTN_TONE[tone], size === "sm" ? "min-h-11 px-5 max-[360px]:px-4 text-[15px] before:inset-x-1.5" : "min-h-12 px-7 text-[16px] before:inset-x-[7px]");
}

export const tag =
  "relative isolate inline-flex items-center gap-2 min-h-8 px-4 font-sans font-medium text-[14px] leading-none text-body whitespace-nowrap before:absolute before:inset-y-0 before:inset-x-[5px] before:-z-1 before:bg-tint-10 before:-skew-x-16";
/** The slash before a status, in the current colour. */
export const dot = "flex-none w-[7px] h-3 bg-current -skew-x-16";
export const tick = "flex-none inline-block w-2 h-[15px] bg-mark -skew-x-16";
export const textLink =
  "inline-flex items-center min-h-11 text-link font-medium whitespace-nowrap underline decoration-1 underline-offset-[0.22em] decoration-link/45 transition-[text-decoration-color] duration-micro ease-enter hover:decoration-current";
/** The small label above a heading, after a gold slash. */
export const eyebrow =
  "flex items-center gap-3 mt-0 mx-0 mb-4 text-[13px] font-medium tracking-[0.06em] uppercase text-muted before:w-2 before:h-[15px] before:bg-accent before:-skew-x-16";
export const lead = "text-[length:clamp(18px,1.5vw,21px)] leading-[1.45] tracking-[-0.008em] text-body";
const LOCKUP = "block aspect-[355.44/100] bg-heading [mask:url(/brand/writz-lockup.svg)_no-repeat_center/contain]";

export const skip =
  "absolute top-2 left-2 z-50 py-3 px-4 bg-accent text-on-accent text-[15px] font-medium [transform:translateY(-150%)] focus-visible:[transform:none] focus-visible:outline-heading";

/* Navbar: full width at the top; once the page scrolls the bar floats as a centred plate */

export const nav = "group/nav sticky top-0 z-20 flow-root h-[72px] -mb-[72px] pointer-events-none @container";
export const navBar = [
  "[--wide:min(100cqw,calc(var(--max)+2*var(--gut)))] [--narrow:min(calc(100cqw-32px),880px)] [--side:calc((var(--wide)-var(--narrow))/2)] [--shift:calc(var(--side)+20px-var(--gut))]",
  "relative isolate flex items-center justify-between gap-6 max-[360px]:gap-2 w-full max-w-[calc(var(--max)+2*var(--gut))] h-[72px] mx-auto px-(--gut)",
  "before:absolute before:inset-0 before:-z-1 before:[clip-path:inset(0)] before:bg-transparent before:transition-[clip-path,background-color] before:duration-section before:ease-enter",
  "after:absolute after:inset-0 after:-z-1 after:[clip-path:inset(0)] after:bg-transparent after:transition-[clip-path,background-color] after:duration-section after:ease-enter",
  "group-data-[floating=true]/nav:before:[clip-path:inset(12px_var(--side)_0)] group-data-[floating=true]/nav:before:bg-line-strong",
  "group-data-[floating=true]/nav:after:[clip-path:inset(13px_calc(var(--side)+1px)_1px)] group-data-[floating=true]/nav:after:bg-surface",
].join(" ");
const NAV_END_MOTION = "pointer-events-auto transition-[transform] duration-section ease-enter";
export const navHome = cx(NAV_END_MOTION, "inline-flex items-center min-h-11 group-data-[floating=true]/nav:[transform:translate(var(--shift),6px)]");
export const navLockup = cx(LOCKUP, "h-6 max-[360px]:h-5");
export const navEnd = cx(NAV_END_MOTION, "flex items-center group-data-[floating=true]/nav:[transform:translate(calc(-1*var(--shift)),6px)]");
export const navLinks = "flex items-center gap-1";
/** A navbar link; below 900px only the ones marked to keep stay. */
export function navLink(keep: boolean): string {
  return cx(
    "inline-flex items-center min-h-11 px-3 max-[360px]:px-2 text-[15px] font-medium text-body transition-[color] duration-micro ease-enter hover:text-heading",
    !keep && "max-[900px]:hidden",
  );
}
export const navTag = cx(tag, "mt-0 mr-1 mb-0 ml-3 max-md:hidden");
export const navCta = cx(btn("gold", "sm"), "ml-3 max-[360px]:ml-1");

/* Footer */

export const footer = "pt-16 pb-10 border-t border-line";
export const footerGrid = "grid grid-cols-[2fr_1fr_1fr_1fr] gap-10 max-md:grid-cols-[1fr_1fr] max-md:gap-y-8 max-md:gap-x-4 max-md:[&>:first-child]:col-span-full";
export const footerHome = "inline-flex items-center min-h-11";
export const footerLockup = cx(LOCKUP, "h-7");
export const footerBio = "m-0 mt-3 max-w-[34ch] text-[15px] text-muted";
/** On pages of running text the footer paragraphs also take the page's paragraph leading, and the legal line its measure. */
export const footerProseBio = "leading-[1.6]";
export const footerProseLegal = "max-w-[680px] leading-[1.6]";
export const footerHeading = "m-0 text-[15px] font-medium leading-[1.4] tracking-[0] text-muted";
export const footerList = "mt-2 mb-0 mx-0 p-0 list-none";
export const footerLink = "inline-flex items-center min-h-11 min-w-11 text-[15px] text-heading hover:underline hover:underline-offset-[0.22em]";
export const footerLegal = "m-0 mt-12 pt-6 border-t border-line text-[14px] text-muted";

/* Home */

/** Entrance animations, only for users who have not asked for reduced motion. h1 and lead stay opaque while rising, since one of them is the LCP. */
const RISE: Record<string, string> = {
  "40ms": "motion-safe:animate-[landing-rise_var(--dur-section)_var(--ease-enter)_40ms_backwards]",
  "250ms": "motion-safe:animate-[landing-rise_var(--dur-section)_var(--ease-enter)_250ms_backwards]",
  "320ms": "motion-safe:animate-[landing-rise_var(--dur-section)_var(--ease-enter)_320ms_backwards]",
  "360ms": "motion-safe:animate-[landing-rise_var(--dur-section)_var(--ease-enter)_360ms_backwards]",
  "600ms": "motion-safe:animate-[landing-rise_var(--dur-section)_var(--ease-enter)_600ms_backwards]",
  "670ms": "motion-safe:animate-[landing-rise_var(--dur-section)_var(--ease-enter)_670ms_backwards]",
  "740ms": "motion-safe:animate-[landing-rise_var(--dur-section)_var(--ease-enter)_740ms_backwards]",
};
const RISE_OPAQUE: Record<string, string> = {
  "100ms": "motion-safe:animate-[landing-rise-opaque_var(--dur-section)_var(--ease-enter)_100ms_backwards]",
  "180ms": "motion-safe:animate-[landing-rise-opaque_var(--dur-section)_var(--ease-enter)_180ms_backwards]",
};
const rise = (delay: string, opaque = false) => (opaque ? RISE_OPAQUE[delay] : RISE[delay]);

export const ctas = "flex flex-wrap gap-y-2 gap-x-1 mt-8 -ml-[7px]";
export const note = "mt-5 text-[14px] text-muted";
const SUB = "text-[14px] text-muted";
export const sub = cx(SUB, "mt-2");
export const secHead = cx(wrap, "flex justify-between [align-items:end] gap-6 mb-12 max-md:flex-col max-md:items-start max-md:mb-8");
const BIG_H2 = "text-[length:clamp(30px,3.6vw,52px)] tracking-[-0.028em] leading-[1.08]";
export const secHeading = BIG_H2;

export const hero = "relative isolate overflow-hidden";
export const heroField =
  "absolute -z-1 top-[72px] bottom-0 left-[calc(50%+72px)] -right-[40%] bg-surface [transform:skewX(-16deg)] origin-top-left max-[1101px]:hidden motion-safe:animate-[landing-field_900ms_var(--ease-enter)_120ms_backwards]";
export const heroIn = cx(
  wrap,
  "grid grid-cols-[minmax(0,1fr)_480px] gap-20 items-center pt-[calc(72px+56px)] pb-[104px] max-[1101px]:grid-cols-[minmax(0,1fr)] max-[1101px]:gap-14 max-[1101px]:pb-0 max-md:gap-10 max-md:pt-[calc(72px+20px)]",
);
export const heroTag = cx(tag, "-ml-[5px] md:hidden", rise("40ms"));
export const heroTagDot = cx(dot, "text-positive");
export const heroTitle = cx("mt-5 md:mt-0 text-[length:clamp(44px,5.3vw,76px)] tracking-[-0.036em] leading-[1.02]", rise("100ms", true));
export const heroAccent = "block text-link";
export const heroLead = cx(lead, "max-w-[30ch] mt-7 max-md:mt-5", rise("180ms", true));
export const heroCtas = cx(ctas, rise("250ms"));
export const heroNote = cx(note, rise("320ms"));
export const heroVis =
  "relative min-w-0 max-[1101px]:mx-[calc(-1*var(--gut))] max-[1101px]:pt-[72px] max-[1101px]:px-(--gut) max-[1101px]:pb-12 max-[1101px]:bg-surface max-[1101px]:[clip-path:polygon(40px_0,100%_0,100%_100%,0_100%,0_139.5px)] max-[1101px]:[&>*]:max-w-[560px] max-md:m-0 max-md:pt-16 max-md:px-4 max-md:pb-8 max-md:[clip-path:polygon(24px_0,100%_0,100%_100%,0_100%,0_83.7px)]";

/* The borrow calculator in the hero */

export const calc = cx("grid gap-5", rise("360ms"));
export const calcRow = "flex justify-between items-center gap-4 text-[15px] text-body";
export const calcRowValue = "text-[17px] text-heading";
export const range = "landing-range";
export const choices = "flex gap-0.5";
export const choice =
  "relative isolate min-w-16 max-md:min-w-14 min-h-11 py-0 px-[14px] border-none bg-transparent text-body aria-checked:text-bg font-mono font-medium text-[14px] leading-none cursor-pointer touch-manipulation select-none focus-visible:outline-none before:absolute before:inset-y-1.5 before:inset-x-[5px] before:-z-1 before:bg-tint-10 aria-checked:before:bg-heading hover:not-aria-checked:before:bg-tint-20 before:-skew-x-16 before:transition-[background-color] before:duration-micro before:ease-enter focus-visible:before:[box-shadow:0_0_0_2px_var(--surface),0_0_0_4px_var(--mark)]";
export const figure = "flex flex-wrap items-baseline gap-y-1 gap-x-3 mt-1 [&>span:last-child]:text-[16px] [&>span:last-child]:text-body";
export const figureValue = "text-[length:clamp(40px,4.6vw,64px)] max-md:text-[44px] leading-none tracking-[-0.03em] text-heading";
export const track = "relative h-2 my-0.5 mx-0 rounded-[4px] bg-tint-20 overflow-hidden";
export const trackFill =
  "absolute inset-y-0 left-0 right-auto w-(--at) rounded-[4px] bg-positive origin-left transition-[width] duration-element ease-enter motion-safe:animate-[landing-grow_var(--dur-section)_var(--ease-enter)_780ms_backwards]";
export const legend = "flex justify-between flex-wrap gap-y-1.5 gap-x-4 text-[15px] [&_.v]:text-heading";

/* The three facts under the hero */

export const facts =
  "grid grid-cols-[repeat(3,minmax(0,1fr))] max-md:grid-cols-[minmax(0,1fr)] gap-y-7 gap-x-12 pt-12 max-md:pt-10 [&_b]:font-semibold [&_b]:text-heading [&_span]:text-[16px]";
const FACT_DELAY = ["600ms", "670ms", "740ms"];
export function fact(i: number): string {
  return cx("grid grid-cols-[auto_1fr] gap-y-1 gap-x-4", rise(FACT_DELAY[i] ?? "600ms"));
}
export const factTick = cx(tick, "[grid-row:span_2] mt-1.5");

/* How it works: four fields, a card in each */

export const how = "mt-40 max-md:mt-28 scroll-mt-24";
export const fields = "grid grid-cols-[repeat(4,minmax(0,1fr))] max-[1101px]:grid-cols-[repeat(2,minmax(0,1fr))] max-md:grid-cols-[minmax(0,1fr)]";
/** The background alternates by column count: four, then two from 1100px, then one below 768px. */
export function field(i: number): string {
  const wide = i % 2 === 1 ? "bg-deep" : "bg-surface";
  const two = i === 1 || i === 2 ? "max-[1101px]:bg-deep" : "max-[1101px]:bg-surface";
  const one = i % 2 === 1 ? "max-md:bg-deep" : "max-md:bg-surface";
  return cx("group/field flex flex-col min-h-[600px] pt-[72px] px-8 pb-10 max-md:min-h-0 max-md:pt-10 max-md:px-(--gut) max-md:pb-12", wide, two, one);
}
export const card =
  "w-full max-w-[280px] max-md:max-w-none pt-5 px-5 pb-[22px] bg-[color-mix(in_oklab,var(--heading)_6%,var(--bg))] transition-[transform] duration-element ease-enter group-hover/field:[transform:translateY(-6px)] [&_dl]:grid [&_dl]:gap-3 [&_dt]:text-[13px] [&_dt]:text-muted [&_dd]:text-[16px] [&_dd]:font-medium [&_dd]:text-heading";
export const progress = "grid grid-cols-[repeat(4,1fr)] gap-1 h-[10px] mb-[18px] px-0.5";
export function progressCell(on: boolean): string {
  return cx("-skew-x-16", on ? "bg-mark" : "bg-tint-20");
}
export const ok = "flex items-center gap-2 mt-[14px] max-w-[34ch] text-[14px] font-medium text-positive";
export const clause =
  "mt-auto pt-14 max-md:-order-1 max-md:mt-0 max-md:mb-7 max-md:pt-0 [&_h3]:text-[length:clamp(21px,1.75vw,25px)] [&_p]:max-w-[34ch] [&_p]:mt-3 [&_p]:text-[16px]";
export const assure = "flex items-start gap-4 max-w-[760px] mt-12 text-[length:clamp(18px,1.5vw,21px)] leading-[1.45] text-heading";
export const assureTick = cx(tick, "mt-2");

/* Products: borrow and lend tiles */

export const products = "mt-40 max-md:mt-28";
export const productsHeading = cx(BIG_H2, "mb-12");
export const tiles = "grid grid-cols-[minmax(0,8fr)_minmax(0,4fr)] max-[1101px]:grid-cols-[minmax(0,1fr)] gap-[10px]";
export function tile(earn: boolean): string {
  return cx(
    "flex flex-col p-12 max-md:pt-16 max-md:px-4 max-md:pb-8 [clip-path:polygon(40px_0,100%_0,100%_100%,0_100%,0_139.5px)] max-md:[clip-path:polygon(24px_0,100%_0,100%_100%,0_100%,0_83.7px)] scroll-mt-24 [&_h3]:text-[length:clamp(25px,2.4vw,34px)] [&_h3]:tracking-[-0.022em] [&_h3]:leading-[1.12]",
    earn ? "bg-deep" : "bg-surface",
  );
}
export const tileText = "max-w-[44ch] mt-3";
export const big =
  "mt-10 text-[16px] text-body [&_b]:block [&_b]:mb-2 [&_b]:font-sans [&_b]:font-semibold [&_b]:text-[length:clamp(64px,7vw,104px)] [&_b]:leading-none [&_b]:tracking-[-0.04em] [&_b]:text-heading";
export const offer = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] max-md:grid-cols-[minmax(0,1fr)] gap-y-6 gap-x-12 [align-items:end]";
export const terms =
  "grid gap-4 [&_div]:pt-[14px] [&_div]:border-t [&_div]:border-line-strong [&_dt]:text-[14px] [&_dt]:text-muted [&_dd]:mt-0.5 [&_dd]:text-[16px] [&_dd]:text-heading";
export const offerSub = cx(SUB, "mt-5");
export const tileFoot = "flex flex-wrap items-center gap-y-2 gap-x-4 mt-auto -ml-[7px] pt-9 [&_span]:text-[14px] [&_span]:text-muted";

/* Evidence: the board of contract tiles */

export const proof = "mt-40 max-md:mt-28";
export const board = cx(wrap, "grid grid-cols-[repeat(4,minmax(0,1fr))] max-[1101px]:grid-cols-[repeat(2,minmax(0,1fr))] max-md:grid-cols-[minmax(0,1fr)] gap-2");
const PTILE = "flex flex-col min-w-0 [clip-path:polygon(20px_0,100%_0,100%_100%,0_100%,0_70px)] min-h-[230px] max-md:min-h-0";
const PTILE_PAD = "pt-7 px-6 pb-6";
export const proofHead = cx(
  PTILE,
  "[grid-column:span_2] max-md:col-span-full p-10 max-md:pt-14 max-md:px-5 max-md:pb-7 bg-accent text-on-accent [&_h2]:max-w-[16ch] [&_h2]:text-[length:clamp(28px,2.8vw,40px)] [&_h2]:text-on-accent [&_:focus-visible]:outline-on-accent [&_*]:selection:bg-on-accent [&_*]:selection:text-accent",
);
// On gold the underline keeps its 45% colour on hover too.
const TEXT_LINK_BASE =
  "inline-flex items-center min-h-11 font-medium whitespace-nowrap underline decoration-1 underline-offset-[0.22em] transition-[text-decoration-color] duration-micro ease-enter";
export const proofHeadLink = cx(TEXT_LINK_BASE, "mt-auto max-md:mt-4 self-start text-on-accent decoration-on-accent/45");
export const contract = cx(PTILE, PTILE_PAD, "bg-surface");
export const contractName = "font-mono font-medium text-[19px] leading-[1.2] text-heading";
export const contractRole = "mt-2 text-[16px]";
export const contractAddress =
  "mt-auto pt-5 font-mono font-normal text-[13px] leading-normal text-muted wrap-anywhere hover:text-link hover:underline focus-visible:outline-offset-2";
export const proofFacts = cx(
  PTILE,
  PTILE_PAD,
  "[grid-column:span_3] max-[1101px]:[grid-column:auto] gap-3 bg-deep [&_p]:text-[16px] [&_p]:text-heading [&_a]:text-link [&_a]:underline [&_a]:underline-offset-[0.22em] pointer-coarse:[&_p_a]:py-[13px]",
);

/* Closing */

export const close = "pt-[168px] pb-[152px] max-md:pt-28 max-md:pb-[104px] text-center";
export const closeHeading = "max-w-[15em] mx-auto my-0 text-[length:clamp(36px,5vw,72px)] tracking-[-0.035em] leading-[1.04] [&_span]:block [&_span]:text-muted";
export const closeText = "mt-6 text-[17px]";
export const closeCtas = cx("flex flex-wrap gap-y-2 gap-x-1 justify-center mt-[30px]", "max-md:[&>a]:flex-[1_1_100%]");
