export function fillFromExecution(aheadBefore: number, executedSize: number, remaining: number): number {
  const overflow = executedSize - aheadBefore;
  if (overflow <= 0) return 0;
  return overflow < remaining ? overflow : remaining;
}
