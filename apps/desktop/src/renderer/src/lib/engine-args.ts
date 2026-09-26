/** Splits a command-line argument string on whitespace, keeping "double-quoted" segments together. */
export function splitEngineArgs(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const result: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    while (i < trimmed.length && /\s/.test(trimmed[i])) i += 1;
    if (i >= trimmed.length) break;
    if (trimmed[i] === '"') {
      i += 1;
      const start = i;
      while (i < trimmed.length && trimmed[i] !== '"') i += 1;
      result.push(trimmed.slice(start, i));
      if (trimmed[i] === '"') i += 1;
      continue;
    }
    const start = i;
    while (i < trimmed.length && !/\s/.test(trimmed[i])) i += 1;
    result.push(trimmed.slice(start, i));
  }
  return result;
}
