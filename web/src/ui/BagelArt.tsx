import { memo, useId } from "react";

// A small top-down bagel for each flavour, picked from keywords in the name.
// Lumpy outline, baked-crust shading, and toppings that sit on the top
// surface. Seeded by the name so each flavour always looks the same.

type Shape = "seed" | "poppy" | "flake" | "salt" | "herb" | "slice" | "cheese" | "raisin" | "olive" | "tomato";
type Topping = { shape: Shape; color: string; count: number; size?: number };
interface Look {
  dough: [number, number, number]; // hsl of the crust at its lightest
  toppings: Topping[];
  swirl?: boolean;
  gloss?: number;
}

const LOOKS: [RegExp, Look][] = [
  [/everything/i, { dough: [30, 52, 52], toppings: [
    { shape: "seed", color: "#f2e3bd", count: 16 }, { shape: "poppy", color: "#24201d", count: 26 },
    { shape: "flake", color: "#8a5524", count: 7 }, { shape: "flake", color: "#efe0b4", count: 5, size: 0.8 }, { shape: "salt", color: "#fffaf0", count: 6 },
  ] }],
  [/sesame/i, { dough: [32, 54, 54], toppings: [{ shape: "seed", color: "#f4e6c2", count: 44 }] }],
  [/popp/i, { dough: [30, 50, 52], toppings: [{ shape: "poppy", color: "#1f1c1b", count: 190, size: 0.85 }] }],
  [/jalap|cheddar|cheese/i, { dough: [33, 58, 54], toppings: [
    { shape: "cheese", color: "#e8892a", count: 6 }, { shape: "slice", color: "#4f8a2b", count: 5 },
  ] }],
  [/cinnamon|raisin/i, { dough: [27, 48, 50], swirl: true, toppings: [{ shape: "raisin", color: "#3a1d14", count: 9 }] }],
  [/onion/i, { dough: [30, 52, 52], toppings: [
    { shape: "flake", color: "#7b4419", count: 12, size: 1.2 }, { shape: "flake", color: "#c88a3e", count: 10 }, { shape: "flake", color: "#ead39a", count: 6, size: 0.8 },
  ] }],
  [/za.?atar|zatar/i, { dough: [32, 50, 52], toppings: [
    { shape: "herb", color: "#5b6b2a", count: 110 }, { shape: "herb", color: "#7c8a3a", count: 40 }, { shape: "seed", color: "#f0e1b8", count: 12, size: 0.8 }, { shape: "poppy", color: "#8e3a2a", count: 14, size: 0.7 },
  ] }],
  [/mediterr|olive|tomato/i, { dough: [32, 52, 53], toppings: [
    { shape: "tomato", color: "#b33a26", count: 5 }, { shape: "olive", color: "#2c2a22", count: 4 }, { shape: "herb", color: "#5e7a2e", count: 40 },
  ] }],
  [/salt|pretzel/i, { dough: [24, 55, 40], toppings: [{ shape: "salt", color: "#fffaf0", count: 22, size: 1.3 }] }],
];
const PLAIN: Look = { dough: [31, 56, 55], toppings: [], gloss: 0.5 };

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const hsl = ([h, s, l]: [number, number, number], dl = 0, ds = 0) => `hsl(${h} ${s + ds}% ${Math.max(0, Math.min(100, l + dl))}%)`;

// Closed lumpy circle as a smooth path.
function blob(cx: number, cy: number, r: number, wobble: number, rand: () => number, pts = 14) {
  const p = Array.from({ length: pts }, (_, i) => {
    const a = (i / pts) * Math.PI * 2;
    const rr = r + (rand() - 0.5) * wobble * 2;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
  let d = "";
  for (let i = 0; i < pts; i++) {
    const [x0, y0] = p[(i - 1 + pts) % pts];
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % pts];
    const [x3, y3] = p[(i + 2) % pts];
    if (i === 0) d += `M${x1.toFixed(2)} ${y1.toFixed(2)}`;
    const c1x = x1 + (x2 - x0) / 6, c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6, c2y = y2 - (y3 - y1) / 6;
    d += `C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  return d + "Z";
}

// Cinnamon swirl: one spiral from the hole out to the edge.
function spiral(cx: number, cy: number, r0: number, r1: number, turns: number) {
  const steps = 90;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2 - Math.PI / 2;
    const r = r0 + (r1 - r0) * t;
    d += `${i ? "L" : "M"}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  }
  return d;
}

export const BagelArt = memo(function BagelArt({ name, size = 56 }: { name: string; size?: number }) {
  const look = LOOKS.find(([re]) => re.test(name))?.[1] ?? PLAIN;
  const rand = rng(name.toLowerCase());
  const uid = useId().replace(/:/g, "");
  const C = 28;
  const R = 23;
  const HOLE = 6.4;

  // Natural variance: each flavour's dough shifts a little in hue and bake.
  const base: [number, number, number] = [look.dough[0] + (rand() - 0.5) * 6, look.dough[1] + (rand() - 0.5) * 8, look.dough[2] + (rand() - 0.5) * 6];
  const outline = blob(C, C, R, 0.55, rand);
  const holeOutline = blob(C + 0.4, C + 0.3, HOLE, 0.6, rand, 9);

  // Points on the top of the ring, away from the hole and the outer edge.
  const onTop = (spread = 1) => {
    const a = rand() * Math.PI * 2;
    const mid = (R + HOLE) / 2 + 0.5;
    const d = mid + (rand() + rand() - 1) * 6.2 * spread;
    return { x: C + Math.cos(a) * d, y: C + Math.sin(a) * d, a: (a * 180) / Math.PI };
  };

  const bits: JSX.Element[] = [];
  look.toppings.forEach((t, ti) => {
    const k = t.size ?? 1;
    for (let i = 0; i < t.count; i++) {
      const { x, y, a } = onTop(t.shape === "cheese" ? 0.7 : 1);
      const rot = a + 90 + (rand() - 0.5) * 70;
      const key = `${ti}-${i}`;
      const tr = `rotate(${rot.toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})`;
      switch (t.shape) {
        case "seed":
          bits.push(
            <g key={key} transform={tr}>
              <ellipse cx={x} cy={y + 0.25} rx={0.85 * k} ry={1.75 * k} fill="#000" opacity="0.18" />
              <ellipse cx={x} cy={y} rx={0.8 * k} ry={1.6 * k} fill={t.color} />
              <ellipse cx={x - 0.2} cy={y - 0.5} rx={0.25 * k} ry={0.6 * k} fill="#fff" opacity="0.55" />
            </g>,
          );
          break;
        case "poppy":
          bits.push(<circle key={key} cx={x} cy={y} r={(0.45 + rand() * 0.25) * k} fill={t.color} />);
          break;
        case "salt":
          bits.push(<rect key={key} x={x - 0.7 * k} y={y - 0.7 * k} width={1.4 * k} height={1.3 * k} rx={0.25} fill={t.color} stroke="#d9cfbd" strokeWidth="0.25" transform={tr} />);
          break;
        case "herb":
          bits.push(<ellipse key={key} cx={x} cy={y} rx={0.28 * k + rand() * 0.25} ry={0.6 * k + rand() * 0.4} fill={t.color} opacity={0.75 + rand() * 0.25} transform={tr} />);
          break;
        case "flake": {
          const s = (1.1 + rand() * 0.9) * k;
          bits.push(
            <path
              key={key}
              d={`M${x - s} ${y - s * 0.3}L${x - s * 0.1} ${y - s * 0.8}L${x + s} ${y - s * 0.2}L${x + s * 0.4} ${y + s * 0.7}L${x - s * 0.7} ${y + s * 0.5}Z`}
              fill={t.color}
              stroke="#000"
              strokeOpacity="0.15"
              strokeWidth="0.3"
              transform={tr}
            />,
          );
          break;
        }
        case "slice":
          // a jalapeño ring: green skin, pale flesh, seeds
          bits.push(
            <g key={key}>
              <circle cx={x} cy={y + 0.3} r={2.3} fill="#000" opacity="0.18" />
              <circle cx={x} cy={y} r={2.2} fill={t.color} />
              <circle cx={x} cy={y} r={1.45} fill="#b7cf7a" />
              <circle cx={x} cy={y} r={0.55} fill="#e8eccb" />
              <circle cx={x - 0.6} cy={y - 0.3} r={0.22} fill="#f3efd6" />
              <circle cx={x + 0.5} cy={y + 0.45} r={0.22} fill="#f3efd6" />
            </g>,
          );
          break;
        case "cheese":
          bits.push(
            <g key={key}>
              <path d={blob(x, y, 3.2 + rand() * 1.4, 1.1, rand, 8)} fill="#8a4a12" opacity="0.35" transform="translate(0.4 0.6)" />
              <path d={blob(x, y, 3 + rand() * 1.4, 1.1, rand, 8)} fill={t.color} />
              <ellipse cx={x - 0.8} cy={y - 0.9} rx={1.1} ry={0.5} fill="#ffd28a" opacity="0.7" />
            </g>,
          );
          break;
        case "raisin":
          bits.push(
            <g key={key}>
              <path d={blob(x, y, 1.35, 0.45, rand, 7)} fill={t.color} />
              <path d={`M${x - 0.6} ${y - 0.2}q0.6 -0.5 1.2 0`} stroke="#6b3a2a" strokeWidth="0.35" fill="none" />
            </g>,
          );
          break;
        case "olive":
          bits.push(
            <g key={key}>
              <circle cx={x} cy={y} r={1.9} fill={t.color} />
              <circle cx={x} cy={y} r={0.75} fill={hsl(base, -10)} />
              <ellipse cx={x - 0.7} cy={y - 0.8} rx={0.5} ry={0.25} fill="#fff" opacity="0.35" />
            </g>,
          );
          break;
        case "tomato":
          bits.push(<path key={key} d={blob(x, y, 1.9, 0.6, rand, 7)} fill={t.color} stroke="#7a2416" strokeWidth="0.35" />);
          break;
      }
    }
  });

  const g = (n: string) => `${uid}${n}`;
  return (
    <svg className="bagel-art" width={size} height={size} viewBox="0 0 56 56" aria-hidden="true">
      <defs>
        {/* baked crust: pale on the high crown of the ring, deep at the edges */}
        <radialGradient id={g("d")} cx={C} cy={C} r={R + 1} gradientUnits="userSpaceOnUse">
          <stop offset="0.27" stopColor={hsl(base, -26, 6)} />
          <stop offset="0.42" stopColor={hsl(base, -6)} />
          <stop offset="0.62" stopColor={hsl(base, 4)} />
          <stop offset="0.82" stopColor={hsl(base, -8)} />
          <stop offset="1" stopColor={hsl(base, -24, 6)} />
        </radialGradient>
        {/* light from the top left */}
        <linearGradient id={g("l")} x1="0.15" y1="0.1" x2="0.85" y2="0.95">
          <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#2a1406" stopOpacity="0.3" />
        </linearGradient>
        {/* blotchy bake marks */}
        <radialGradient id={g("b")}>
          <stop offset="0" stopColor={hsl(base, -18, 4)} stopOpacity="0.55" />
          <stop offset="1" stopColor={hsl(base, -18, 4)} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={g("h")} cx="0.45" cy="0.4" r="0.7">
          <stop offset="0" className="bagel-hole-stop" />
          <stop offset="0.75" className="bagel-hole-stop" />
          <stop offset="1" stopColor="#2a1406" stopOpacity="0.55" />
        </radialGradient>
        <clipPath id={g("c")}>
          <path d={outline} />
        </clipPath>
      </defs>

      <ellipse cx={C + 1.2} cy={C + 2.4} rx={R + 0.5} ry={R - 0.5} fill="#2a1406" opacity="0.16" />
      <g clipPath={`url(#${g("c")})`}>
        <path d={outline} fill={`url(#${g("d")})`} />
        {Array.from({ length: 5 }, (_, i) => {
          const p = onTop(0.6);
          return <circle key={`m${i}`} cx={p.x} cy={p.y} r={3 + rand() * 3} fill={`url(#${g("b")})`} />;
        })}
        {look.swirl && (
          <path d={spiral(C, C, HOLE + 1.5, R - 2, 2.6)} fill="none" stroke={hsl(base, -26, 10)} strokeWidth="2.2" strokeLinecap="round" opacity="0.55" />
        )}
        {look.gloss && <ellipse cx={C - 7} cy={C - 9} rx={7} ry={3} fill="#fff" opacity={look.gloss * 0.35} transform={`rotate(-35 ${C - 7} ${C - 9})`} />}
        {bits}
        <path d={outline} fill={`url(#${g("l")})`} />
      </g>
      <path d={holeOutline} fill={`url(#${g("h")})`} />
      <path d={holeOutline} fill="none" stroke="#2a1406" strokeOpacity="0.35" strokeWidth="0.8" />
    </svg>
  );
});
