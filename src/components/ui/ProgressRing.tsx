import { RING_RADIUS, ringFigures } from "@/lib/ring";

/**
 * A ring that fills as the share of the rent that was collected grows, with the whole percent in the middle. It is an image
 * for a screen reader ("62% collected"). It is drawn in the tokens' colours (a track, and the accent), and it does not animate:
 * a ring that sweeps on every month switch would be motion for its own sake.
 */
export function ProgressRing({ percent }: { percent: number }) {
  const { percent: whole, circumference, offset, label } = ringFigures(percent);
  return (
    <div role="img" aria-label={label} className="relative size-21 shrink-0">
      <svg aria-hidden="true" viewBox="0 0 84 84" fill="none" strokeWidth="9" className="size-full -rotate-90">
        <circle cx="42" cy="42" r={RING_RADIUS} className="stroke-surface-2" />
        <circle
          cx="42"
          cy="42"
          r={RING_RADIUS}
          className="stroke-accent"
          strokeLinecap="round"
          strokeDasharray={circumference.toFixed(1)}
          strokeDashoffset={offset.toFixed(1)}
        />
      </svg>
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center font-display text-lg font-bold">
        {whole}%
      </span>
    </div>
  );
}
