export const SIM_PLACEHOLDER_MAC = "08:3A:8D:15:27:54" as const;

export function maskSimMac(mac?: string | null): string {
  const trimmed = (mac ?? "").trim();
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  return upper === SIM_PLACEHOLDER_MAC ? "" : upper;
}
