export const MAC_ONLY_REGEX = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

export const canonicalMac = (raw: string): string | null => {
  const s = String(raw || "").trim();
  if (!s) return null;
  const hex = s.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length !== 12) return null;
  const mac = hex.match(/.{1,2}/g)?.join(":") || "";
  return MAC_ONLY_REGEX.test(mac) ? mac : null;
};

export const extractMac = (raw: string): string | null => {
  const s = String(raw || "").toUpperCase();
  const m1 = s.match(/([0-9A-F]{2}(?::[0-9A-F]{2}){5})/);
  if (m1 && m1[1]) return m1[1];
  const m2 = s.match(/\b([0-9A-F]{12})\b/);
  if (m2 && m2[1]) {
    const parts = m2[1].match(/.{1,2}/g) || [];
    const mac = parts.join(":");
    return MAC_ONLY_REGEX.test(mac) ? mac : null;
  }
  return null;
};

export const macKey = (raw: string): string =>
  (canonicalMac(raw) || extractMac(raw) || raw).replace(/[^0-9A-F]/gi, "").toUpperCase();
