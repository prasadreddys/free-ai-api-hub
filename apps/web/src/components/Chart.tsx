// FREE AI API HUB — dependency-free SVG area chart (requests over time).
// Pure SVG, no chart library, theme-aware via currentColor + explicit fills.

export interface ChartPoint {
  label: string;
  requests: number;
  errors: number;
}

export function AreaChart({ points, height = 180 }: { points: ChartPoint[]; height?: number }) {
  const width = 640;
  const padding = { top: 12, right: 12, bottom: 24, left: 40 };
  const max = Math.max(1, ...points.map((p) => p.requests));
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const x = (i: number) => padding.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => padding.top + innerH - (v / max) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.requests).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(padding.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padding.top + innerH).toFixed(1)} Z`;
  const errorLine = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.errors).toFixed(1)}`).join(" ");

  // Y-axis ticks.
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  // X labels: first, middle, last.
  const labelIdx = points.length > 0 ? [0, Math.floor(points.length / 2), points.length - 1] : [];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={`Requests over time, peak ${max}`}
    >
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={y(t)}
            y2={y(t)}
            stroke="currentColor"
            strokeOpacity="0.12"
          />
          <text x={padding.left - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.6">
            {t}
          </text>
        </g>
      ))}
      <path d={area} fill="url(#areaFill)" />
      <path d={line} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinejoin="round" />
      {points.some((p) => p.errors > 0) && (
        <path d={errorLine} fill="none" stroke="#f43f5e" strokeWidth="1.5" strokeDasharray="4 3" />
      )}
      {labelIdx.map((i) => (
        <text
          key={i}
          x={x(i)}
          y={height - 6}
          textAnchor="middle"
          fontSize="10"
          fill="currentColor"
          opacity="0.6"
        >
          {points[i]?.label ?? ""}
        </text>
      ))}
    </svg>
  );
}
