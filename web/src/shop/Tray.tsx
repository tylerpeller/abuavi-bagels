import { memo } from "react";

// The signature: one ring per bagel in the drop. Taken bagels leave an
// empty dashed slot; the ones you're about to take glow in your colour.
const MAX_RINGS = 240;

interface Props {
  capacity: number;
  remaining: number;
  mine: number;
  dim?: boolean;
}

export const Tray = memo(function Tray({ capacity, remaining, mine, dim }: Props) {
  const per = Math.max(1, Math.ceil(capacity / MAX_RINGS));
  const rings = Math.ceil(capacity / per);
  const left = Math.ceil(remaining / per);
  const yours = Math.min(left, Math.ceil(mine / per));
  const cols = rings <= 120 ? 10 : 15;

  return (
    <figure className="tray" data-dim={dim || undefined}>
      <div className="tray-grid" style={{ ["--cols" as string]: cols }} role="img" aria-label={`${remaining} of ${capacity} bagels left`}>
        {Array.from({ length: rings }, (_, i) => {
          const state = i >= left ? "taken" : i >= left - yours ? "mine" : "free";
          return (
            <span key={i} className="slot" data-s={state}>
              <span className="bagel" />
            </span>
          );
        })}
      </div>
      <figcaption>
        {per === 1 ? "Each ring is one bagel." : `Each ring is ${per} bagels.`}
        {mine > 0 && left > 0 ? " The bright ones are yours." : ""}
      </figcaption>
    </figure>
  );
});
