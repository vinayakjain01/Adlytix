/** Last `days` days ending today, as ISO date strings — the shape every Integration-mode analytics call takes. */
export function daysToRange(days: number): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - (days - 1));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { since: fmt(since), until: fmt(until) };
}
