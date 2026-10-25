/** "1.5%" from 150 basis points. */
export function formatBp(bp: number): string {
  return `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : bp % 10 === 0 ? 1 : 2)}%`;
}
