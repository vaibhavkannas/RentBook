/** The radius of the progress ring's circle, in the units of its 84 by 84 drawing. */
export const RING_RADIUS = 36;

/**
 * What the progress ring is drawn from: the whole percent (0 to 100), the circle's length and how much of it is left empty
 * (the stroke-dashoffset), and the words a screen reader gets. Pure on purpose, so the figures can be tested.
 */
export function ringFigures(percent: number): { percent: number; circumference: number; offset: number; label: string } {
  const whole = Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : 0;
  const circumference = 2 * Math.PI * RING_RADIUS;
  return { percent: whole, circumference, offset: circumference * (1 - whole / 100), label: `${whole}% collected` };
}
