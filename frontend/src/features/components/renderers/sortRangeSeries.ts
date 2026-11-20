function rangeBounds(name: unknown): [number, number] | null {
  const text = String(name ?? "").trim();
  const number = "([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))";
  const range = text.match(new RegExp(`^${number}\\s*[-~～–—]\\s*${number}$`));
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    return Number.isFinite(low) && Number.isFinite(high) && low <= high ? [low, high] : null;
  }
  const bound = text.match(new RegExp(`^(<=|>=|<|>|≤|≥)\\s*${number}$`));
  if (!bound) return null;
  const value = Number(bound[2]);
  if (!Number.isFinite(value)) return null;
  return bound[1].startsWith("<") || bound[1] === "≤" ? [-Infinity, value] : [value, Infinity];
}

export function sortRangeSeries<T extends { name?: unknown }>(series: T[]): T[] {
  const ranked = series.map((item) => ({ item, bounds: rangeBounds(item.name) }));
  if (ranked.some(({ bounds }) => bounds === null)) return series;
  return ranked.sort((a, b) => {
    const [lowA, highA] = a.bounds!;
    const [lowB, highB] = b.bounds!;
    return (lowA === lowB ? 0 : lowA < lowB ? -1 : 1)
      || (highA === highB ? 0 : highA < highB ? -1 : 1);
  }).map(({ item }) => item);
}
