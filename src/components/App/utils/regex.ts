export const FALLBACK_KFB_REGEX = /^KFB$/;

export const compileRegex = (
  src: string | undefined,
  fallback: RegExp
): RegExp => {
  if (!src) return fallback;
  try {
    if (src.startsWith("/") && src.lastIndexOf("/") > 0) {
      const i = src.lastIndexOf("/");
      const pattern = src.slice(1, i);
      const flags = src.slice(i + 1);
      return new RegExp(pattern, flags);
    }
    return new RegExp(src);
  } catch {
    console.warn("Invalid NEXT_PUBLIC_KFB_REGEX. Using fallback.");
    return fallback;
  }
};

export const KFB_REGEX = compileRegex(
  process.env.NEXT_PUBLIC_KFB_REGEX,
  FALLBACK_KFB_REGEX
);
