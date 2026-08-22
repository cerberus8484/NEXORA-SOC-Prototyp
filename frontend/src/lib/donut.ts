// Pure Geometrie-/Prozent-Helfer für das Donut-Diagramm — unit-testbar.

export interface DonutArc { dash: number; gap: number; offset: number; }

/** Gerundeter Prozentwert eines Segments. */
export function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

/**
 * Berechnet stroke-dasharray/-offset je Segment für einen Kreis mit gegebenem Umfang.
 * Bei total = 0 sind alle Bögen leer.
 */
export function donutArcs(values: number[], circumference: number): DonutArc[] {
  const total = values.reduce((s, v) => s + v, 0);
  let offset = 0;
  return values.map((v) => {
    const dash = total > 0 ? (v / total) * circumference : 0;
    const arc: DonutArc = { dash, gap: circumference - dash, offset: -offset };
    offset += dash;
    return arc;
  });
}
