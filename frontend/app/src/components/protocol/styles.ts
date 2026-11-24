/** The Protocol page: live reads in blocks, a retention table and the contract list. */

export const grid =
  "grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-12 mt-12 [align-items:start] max-xl:grid-cols-[minmax(0,1fr)] max-xl:mt-10 max-md:mt-8";
export const block = "flex flex-col gap-1 min-w-0";
export const wide = "mt-16 max-md:mt-12";
export const blockHead = "flex justify-between items-baseline flex-wrap gap-y-1 gap-x-4 mb-4";
export const h2 = "text-[length:clamp(21px,1.8vw,25px)] font-semibold tracking-[-0.014em] leading-[1.25]";
export const at = "font-[family-name:var(--ff-mono),ui-monospace,monospace] text-[13px] text-muted";
export const note = "mb-4 max-w-[60ch] text-[15px] text-body";
export const text = "text-[17px] leading-[1.3]";
/** A hint placed straight in a block. */
export const blockHint = "mt-3";

/** The retention table; below 768px each row becomes a card with the column name before each value. */
export const table = [
  "w-full border-separate [border-spacing:0_4px] text-[15px]",
  "[&_th]:pt-4 [&_th]:pr-5 [&_th]:pb-4 [&_th]:pl-0 [&_td]:pt-4 [&_td]:pr-5 [&_td]:pb-4 [&_td]:pl-0 [&_th]:text-left [&_td]:text-left [&_th]:font-normal [&_td]:font-normal [&_th]:text-heading [&_td]:text-heading [&_th]:align-middle [&_td]:align-middle",
  "[&_tbody_th]:bg-[color-mix(in_oklab,var(--heading)_6%,var(--bg))] [&_tbody_td]:bg-[color-mix(in_oklab,var(--heading)_6%,var(--bg))] [&_tbody_th]:pl-5",
  "[&_thead_th]:pt-0 [&_thead_th]:pb-1 [&_thead_th]:text-[13px] [&_thead_th]:text-muted [&_thead_th:first-child]:pl-5",
  "max-md:[&_thead]:hidden max-md:block max-md:[&_tbody]:block max-md:[&_tr]:block",
  "max-md:[&_tr]:mb-1 max-md:[&_tr]:py-2.5 max-md:[&_tr]:px-4 max-md:[&_tr]:bg-[color-mix(in_oklab,var(--heading)_6%,var(--bg))]",
  "max-md:[&_tbody_th]:flex max-md:[&_tbody_td]:flex max-md:[&_tbody_th]:justify-between max-md:[&_tbody_td]:justify-between max-md:[&_tbody_th]:items-center max-md:[&_tbody_td]:items-center max-md:[&_tbody_th]:flex-wrap max-md:[&_tbody_td]:flex-wrap max-md:[&_tbody_th]:gap-y-1 max-md:[&_tbody_td]:gap-y-1 max-md:[&_tbody_th]:gap-x-3 max-md:[&_tbody_td]:gap-x-3 max-md:[&_tbody_th]:py-1.5 max-md:[&_tbody_td]:py-1.5 max-md:[&_tbody_th]:px-0 max-md:[&_tbody_td]:px-0 max-md:[&_tbody_th]:bg-transparent max-md:[&_tbody_td]:bg-transparent",
  "max-md:[&_th]:before:content-[attr(data-label)] max-md:[&_td]:before:content-[attr(data-label)] max-md:[&_th]:before:text-body max-md:[&_td]:before:text-body max-md:[&_th]:before:font-[family-name:var(--font-sans)] max-md:[&_td]:before:font-[family-name:var(--font-sans)] max-md:[&_th]:before:text-[14px] max-md:[&_td]:before:text-[14px]",
].join(" ");
export const ret = "inline-flex items-center gap-3";
export function bar(partial: boolean): string {
  return `relative inline-block w-[140px] max-md:w-20 h-2 rounded-[4px] bg-tint-20 overflow-hidden flex-none [&>span]:block [&>span]:h-full [&>span]:rounded-[4px] ${partial ? "[&>span]:bg-info" : "[&>span]:bg-positive"}`;
}
export const contracts =
  "grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-1 m-0 [&>div]:flex [&>div]:justify-between [&>div]:items-center [&>div]:flex-wrap [&>div]:gap-y-1 [&>div]:gap-x-4 [&>div]:min-h-14 [&>div]:py-1.5 [&>div]:px-5 max-md:[&>div]:px-4 [&>div]:bg-[color-mix(in_oklab,var(--heading)_6%,var(--bg))] [&>div]:text-[15px] [&_dt]:text-body [&_dd]:m-0 [--link-display:inline-flex] [--link-align:center] [--link-min-h:44px] [&_a]:text-[14px]";
