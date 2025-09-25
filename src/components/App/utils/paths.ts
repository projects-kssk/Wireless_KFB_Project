export const isAcmPath = (p?: string | null): boolean =>
  !p ||
  /(^|\/)ttyACM\d+$/.test(p) ||
  /(^|\/)ttyUSB\d+$/.test(p) ||
  /(^|\/)(ACM|USB)\d+($|[^0-9])/.test(p) ||
  /\/by-id\/.*(ACM|USB)/i.test(p);

export const pathsEqual = (a?: string | null, b?: string | null): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = a.split("/").pop() || a;
  const tb = b.split("/").pop() || b;
  if (ta === tb || a.endsWith(tb) || b.endsWith(ta)) return true;
  const num = (s: string) => {
    const m = s.match(/(ACM|USB)(\d+)/i);
    return m ? `${m[1].toUpperCase()}${m[2]}` : null;
  };
  const na = num(a) || num(ta);
  const nb = num(b) || num(tb);
  return !!(na && nb && na === nb);
};

export const resolveDesiredPath = (
  list: string[] | readonly string[] | undefined | null
): string | null => {
  if (!Array.isArray(list) || list.length === 0) return null;
  const acm0 = list.find(
    (p) => /(^|\/)ttyACM0$/.test(p) || /(\/|^)(ACM)0(?!\d)/i.test(p)
  );
  if (acm0) return acm0;
  const fallback = list.find((p) => /(^|\/)ttyACM\d+$/i.test(p));
  if (fallback) return fallback;
  return null;
};
