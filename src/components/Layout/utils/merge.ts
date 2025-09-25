export type AliasCarrier = {
  aliases?: Record<string, string>;
};

export const mergeAliasesFromItems = (
  items?: Array<AliasCarrier | null> | null
): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!Array.isArray(items)) return out;
  for (const it of items) {
    if (!it) continue;
    const aliases = it.aliases || {};
    for (const [pin, name] of Object.entries(aliases)) {
      out[pin] = out[pin] && out[pin] !== name ? `${out[pin]} / ${name}` : name;
    }
  }
  return out;
};

export type PinCarrier = {
  ksk?: string;
  kssk?: string;
  normalPins?: number[];
  latchPins?: number[];
};

export const computeActivePins = (
  items: Array<PinCarrier | null> | undefined,
  activeIds: string[] | undefined
): { normal: number[]; latch: number[] } => {
  const ids = new Set((activeIds || []).map((s) => String(s).trim()));
  const normalPins = new Set<number>();
  const latchPins = new Set<number>();

  if (Array.isArray(items) && ids.size) {
    for (const entry of items) {
      if (!entry) continue;
      const id = String((entry.ksk ?? entry.kssk) || "").trim();
      if (!id || !ids.has(id)) continue;
      if (Array.isArray(entry.normalPins)) {
        for (const p of entry.normalPins) {
          const value = Number(p);
          if (Number.isFinite(value) && value > 0) normalPins.add(value);
        }
      }
      if (Array.isArray(entry.latchPins)) {
        for (const p of entry.latchPins) {
          const value = Number(p);
          if (Number.isFinite(value) && value > 0) latchPins.add(value);
        }
      }
    }
  }

  return {
    normal: Array.from(normalPins).sort((a, b) => a - b),
    latch: Array.from(latchPins).sort((a, b) => a - b),
  };
};
