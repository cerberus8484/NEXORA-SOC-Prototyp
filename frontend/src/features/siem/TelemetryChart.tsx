import { useEffect, useRef } from 'react';
import type { TelemetryPoint } from './siemApi';
import { niceMax, bucketTimeLabel } from './telemetryModel';

export interface ChartSeries {
  label: string;
  /** CSS-Farbwert oder var(--token) — wird beim Zeichnen aufgelöst. */
  color: string;
  points: TelemetryPoint[];
  /** Fläche unter der Linie füllen (Standard: true). */
  fill?: boolean;
}

interface TelemetryChartProps {
  series: ChartSeries[];
  height?: number;
}

/** Löst var(--token) gegen das aktuelle Theme auf — Canvas kennt keine CSS-Variablen. */
function resolveColor(color: string, el: HTMLElement): string {
  const m = color.match(/^var\((--[\w-]+)\)$/);
  if (!m) return color;
  return getComputedStyle(el).getPropertyValue(m[1]).trim() || '#00c8ff';
}

function hexWithAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#')) return hex;
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return hex.length === 7 ? `${hex}${a}` : hex;
}

/**
 * Glow-Liniendiagramm auf Canvas — Nexora-Stil (Leuchtlinien, Verlaufflächen,
 * dezente Gridlines). Zeichnet bei Datenänderung neu, kein Animations-Loop.
 */
export function TelemetryChart({ series, height = 150 }: TelemetryChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      const W = canvas.width;
      const H = canvas.height;
      const pad = 4 * dpr;
      const padBottom = 16 * dpr;
      ctx.clearRect(0, 0, W, H);

      const gridColor = resolveColor('var(--border-soft)', canvas);
      const textDim = resolveColor('var(--text-dim)', canvas);
      const rawMax = Math.max(...series.flatMap((s) => s.points.map((p) => p.count)), 1);
      const max = niceMax(rawMax);
      const plotH = H - pad - padBottom;

      // Gridlines (3 horizontale Hilfslinien)
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      for (let g = 1; g <= 3; g += 1) {
        const y = pad + (plotH * g) / 4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      for (const s of series) {
        const n = s.points.length;
        if (n < 2) continue;
        const color = resolveColor(s.color, canvas);
        const pts = s.points.map((p, i) => [
          (i / (n - 1)) * W,
          pad + plotH - (p.count / max) * plotH,
        ] as const);

        if (s.fill !== false) {
          const grad = ctx.createLinearGradient(0, 0, 0, H);
          grad.addColorStop(0, hexWithAlpha(color, 0.22));
          grad.addColorStop(1, hexWithAlpha(color, 0));
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pad + plotH);
          pts.forEach(([x, y]) => ctx.lineTo(x, y));
          ctx.lineTo(pts[n - 1][0], pad + plotH);
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
        }

        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 8 * dpr;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6 * dpr;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();

        // Leuchtpunkt am aktuellen Wert
        const [lx, ly] = pts[n - 1];
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(Math.min(lx, W - 3 * dpr), ly, 2.4 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // X-Achse: erste / letzte Bucket-Zeit
      const first = series[0]?.points[0]?.t;
      const last = series[0]?.points[series[0].points.length - 1]?.t;
      if (first && last) {
        ctx.fillStyle = textDim;
        ctx.font = `${10 * dpr}px ui-monospace, monospace`;
        ctx.textBaseline = 'bottom';
        ctx.fillText(bucketTimeLabel(first), 2 * dpr, H - 2 * dpr);
        const lastLabel = bucketTimeLabel(last);
        ctx.fillText(lastLabel, W - ctx.measureText(lastLabel).width - 2 * dpr, H - 2 * dpr);
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [series]);

  return <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block' }} />;
}
