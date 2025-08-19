import React from "react";
import { m } from 'framer-motion'
type Size = "md" | "lg" | "xl";
type Variant = "pill" | "card";

export interface SupportInfo {
  count?: number;         // e.g., open tickets
  label?: string;         // default: "SUPPORT"
  subtitle?: string;      // e.g., "24/7 Hotline"
  ctaText?: string;       // e.g., "Call"
  onCta?: () => void;     // CTA handler
}

export const SupportContactCard: React.FC<{
  supportInfo: Partial<SupportInfo>;
  size?: Size;
  variant?: Variant;
  emphasis?: boolean;
}> = ({ supportInfo, size = "lg", variant = "pill", emphasis = false }) => {
  const { count, label = "SUPPORT", subtitle, ctaText, onCta } = supportInfo;

  const sizeClasses =
    size === "xl"
      ? {
          container: "h-14 2xl:h-16 px-5 2xl:px-6",
          label: "text-base 2xl:text-lg",
          countInside: "text-2xl 2xl:text-3xl",
          subtitle: "text-sm 2xl:text-base",
          cta: "text-sm 2xl:text-base px-3 py-1.5",
          gap: "gap-3",
        }
      : size === "lg"
      ? {
          container: "h-12 px-4",
          label: "text-sm",
          countInside: "text-xl",
          subtitle: "text-xs",
          cta: "text-xs px-2.5 py-1.5",
          gap: "gap-2.5",
        }
      : {
          container: "h-10 px-3",
          label: "text-xs",
          countInside: "text-lg",
          subtitle: "text-[11px]",
          cta: "text-[11px] px-2 py-1",
          gap: "gap-2",
        };

  const pillClasses = [
    "inline-flex items-center",
    sizeClasses.container,
    "rounded-full",
    "border border-white/60 dark:border-white/10",
    "bg-white/85 dark:bg-slate-800/70 backdrop-blur-xl",
    "text-slate-900 dark:text-slate-50",
    "shadow-sm",
  ].join(" ");

  const cardClasses = [
    "rounded-2xl",
    "border border-white/60 dark:border-white/10",
    "bg-white/85 dark:bg-slate-800/70 backdrop-blur-xl",
    "text-slate-900 dark:text-slate-50",
    "shadow-sm",
    "px-5 py-4",
  ].join(" ");

  return (
    <m.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={variant === "pill" ? pillClasses : cardClasses}
      style={
        emphasis
          ? { boxShadow: "0 0 0 2px rgba(255,255,255,0.25), 0 8px 24px rgba(0,0,0,0.15)" }
          : undefined
      }
    >
      <div className={`inline-flex items-center ${sizeClasses.gap}`}>
        {/* Unified label with count: "SUPPORT: 453" */}
        <span
          className={[
            "inline-flex items-center",
            "px-3 py-1 rounded-full",
            "bg-slate-900 text-white dark:bg-white dark:text-slate-900",
            "font-extrabold tracking-[0.08em]",
            sizeClasses.label,
          ].join(" ")}
          style={{ letterSpacing: "0.08em" }}
          aria-live="polite"
        >
          <span>{label.toUpperCase()}:</span>
          {typeof count === "number" && (
            <span className={`ml-2 tabular-nums ${sizeClasses.countInside}`}>{count}</span>
          )}
        </span>

        {/* Subtitle (optional) */}
        {subtitle && (
          <span className={`opacity-80 ${sizeClasses.subtitle}`}>{subtitle}</span>
        )}

        {/* CTA (optional) */}
        {ctaText && (
          <button
            onClick={onCta}
            className={[
              "ml-2 inline-flex items-center rounded-full",
              "bg-slate-900/90 text-white dark:bg-white/90 dark:text-slate-900",
              "hover:opacity-90 active:opacity-80 transition-opacity",
              sizeClasses.cta,
            ].join(" ")}
          >
            {ctaText}
          </button>
        )}
      </div>
    </m.div>
  );
};
