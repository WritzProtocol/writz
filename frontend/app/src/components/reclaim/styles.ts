/** The reclaim help page and the loans it lists. */

export const page = "flex flex-col pt-4 max-md:pt-2";
export const h1 = "max-w-[18ch] text-[length:clamp(40px,4.6vw,68px)] font-semibold tracking-[-0.035em] leading-[1.04] text-balance";
export const h2 = "text-[length:clamp(21px,1.8vw,25px)] font-semibold tracking-[-0.014em] leading-[1.25]";
export const h3 = "text-[17px] font-semibold tracking-[-0.01em]";
export const grid =
  "grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] [grid-template-areas:'lock_when'_'need_when'] [grid-template-rows:auto_1fr] gap-12 mt-12 [align-items:start] max-xl:grid-cols-[minmax(0,1fr)] max-xl:[grid-template-areas:'lock'_'when'_'need'] max-xl:[grid-template-rows:none] max-xl:gap-10 max-xl:mt-10 max-md:mt-8 max-md:gap-8";
const SECTION = "flex flex-col gap-3 min-w-0";
export const lock = `[grid-area:lock] ${SECTION}`;
export const need = `[grid-area:need] ${SECTION}`;
export const when = "[grid-area:when] flex flex-col gap-3 pt-12 pr-8 pb-8 pl-12 max-md:pt-14 max-md:px-4 max-md:pb-6 max-xl:max-w-[720px] bg-surface";
export const lead = "max-w-[56ch] text-[19px] max-md:text-[17px] leading-normal text-heading";
export const needList = "mt-1 max-w-[60ch] text-[16px]";

export const loans = "flex flex-col gap-1 mt-1";
export const loan =
  "flex flex-col gap-[10px] p-5 bg-[color-mix(in_oklab,var(--heading)_6%,var(--bg))] [&_p]:text-[15px] [&_b]:inline-flex [&_b]:items-center [&_b]:gap-2 [&_b]:text-positive [&_b]:font-medium [&_b]:before:w-[7px] [&_b]:before:h-3 [&_b]:before:bg-current [&_b]:before:-skew-x-16 [&_b]:before:flex-none";
export const facts =
  "grid gap-1 mt-1 mb-0 mx-0 text-[14px] [&>div]:flex [&>div]:justify-between [&>div]:items-center [&>div]:flex-wrap [&>div]:gap-y-0.5 [&>div]:gap-x-3 [&>div]:min-h-8 [&>div]:pt-2 [&>div]:border-t [&>div]:border-line [&_dt]:text-muted [&_dd]:m-0 [&_dd]:text-heading [--link-display:inline-flex] [--link-align:center] [--link-min-h:44px]";

export const stepsWrap = `${SECTION} mt-16 max-md:mt-12`;
export const steps =
  "grid grid-cols-[repeat(4,minmax(0,1fr))] max-xl:grid-cols-[repeat(2,minmax(0,1fr))] max-md:grid-cols-[minmax(0,1fr)] gap-1 mt-1 mb-2 mx-0 p-0 list-none [&_li]:flex [&_li]:flex-col [&_li]:gap-2 [&_li]:min-w-0 [&_li]:p-6 max-md:[&_li]:py-5 max-md:[&_li]:px-4 [&_li]:bg-[color-mix(in_oklab,var(--heading)_6%,var(--bg))] [&_p]:text-[15px]";
export const stepN =
  "relative isolate self-start inline-grid place-items-center min-w-11 h-7 mt-0 mr-0 mb-2 -ml-1 px-3 text-on-accent text-[14px] font-medium before:absolute before:inset-y-0 before:inset-x-1 before:-z-1 before:bg-accent before:-skew-x-16";
