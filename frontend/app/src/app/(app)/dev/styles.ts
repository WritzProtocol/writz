/** The harness pages under /dev: an index of every mock scenario and galleries of component states. */

export const page = "flex flex-col gap-12";
export const head =
  "flex flex-col gap-4 max-w-[760px] [&_h1]:text-[length:clamp(40px,4.6vw,64px)] [&_h1]:font-semibold [&_h1]:tracking-[-0.035em] [&_h1]:leading-[1.02] [&_p]:text-[17px] [&_p]:text-body [&_.mono]:text-heading";
export const areas = "flex flex-wrap gap-1 -ml-1.5 [&>a]:no-underline";
export const group =
  "flex flex-col gap-3 scroll-mt-24 [&_h2]:flex [&_h2]:items-baseline [&_h2]:gap-3 [&_h2]:text-[21px] [&_h2]:font-semibold [&_h2]:tracking-[-0.014em]";
export const count = "font-[family-name:var(--ff-mono),ui-monospace,monospace] text-[14px] font-normal text-muted";
export const list = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-1 m-0 p-0 list-none";
export const item =
  "relative flex flex-col gap-0.5 min-h-16 py-3 pr-11 pl-4 bg-[color-mix(in_oklab,var(--heading)_6%,var(--bg))] text-heading no-underline transition-[background-color] duration-micro ease-enter motion-reduce:transition-none hover:bg-tint-10 focus-visible:outline-offset-[-2px]";
export const id = "text-[14px] text-mark wrap-anywhere";
export const name = "text-[15px]";
export const route = "text-[13px] text-muted wrap-anywhere";
export const ext = "absolute top-[14px] right-4 text-muted";
