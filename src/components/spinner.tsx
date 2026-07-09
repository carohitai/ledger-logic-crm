import type { CSSProperties } from "react";

/**
 * A brand loading ring. Colour comes from `currentColor` by default, so it
 * inherits the surrounding text/button colour and looks correct on every
 * surface (solid buttons, ghost buttons, links). Give it a `color` when the
 * ring should differ from the text (e.g. white ring on a coloured button).
 */
export function Spinner({
  size = 16,
  thickness,
  color = "currentColor",
  track = "color-mix(in srgb, currentColor 24%, transparent)",
  className = "",
  label = "Loading",
  style,
}: {
  size?: number;
  thickness?: number;
  color?: string;
  track?: string;
  className?: string;
  label?: string;
  style?: CSSProperties;
}) {
  const bw = thickness ?? Math.max(2, Math.round(size / 8));
  return (
    <span
      role="status"
      aria-label={label}
      className={`ll-spinner ${className}`}
      style={{
        width: size,
        height: size,
        borderWidth: bw,
        borderColor: track,
        borderTopColor: color,
        ...style,
      }}
    />
  );
}
