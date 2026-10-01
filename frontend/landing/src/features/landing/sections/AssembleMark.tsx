import { MARK_PIECES } from "../markPieces";

type Piece = {
  d: string;
  delay: number;
  x: number;
  y: number;
  rotate: number;
  scale: number;
};

// Scatter offsets are in viewBox units: 1180 units span the 260px box.
const U = 1180 / 260;

const PIECES: Piece[] = [
  { d: MARK_PIECES.leftUpperFeather, delay: 0, x: -430 * U, y: -346 * U, rotate: -11, scale: 2 },
  { d: MARK_PIECES.rightUpperFeather, delay: 60, x: 448 * U, y: -322 * U, rotate: 10, scale: 2 },
  { d: MARK_PIECES.leftLowerFeather, delay: 120, x: -338 * U, y: -152 * U, rotate: 8, scale: 1.7 },
  { d: MARK_PIECES.rightLowerFeather, delay: 180, x: 352 * U, y: -138 * U, rotate: -9, scale: 1.7 },
  { d: MARK_PIECES.centralW, delay: 240, x: 66 * U, y: 58 * U, rotate: 4, scale: 1.5 },
];

export function AssembleMark({ assembled }: { assembled: boolean }) {
  return (
    <div className="assemble" aria-hidden="true">
      <svg viewBox="-125 -266 1180 1180">
        {PIECES.map((p) => (
          <path
            key={p.delay}
            d={p.d}
            style={{
              fill: "var(--heading)",
              opacity: assembled ? 1 : 0.15,
              transform: assembled
                ? "none"
                : `translate(${p.x}px, ${p.y}px) rotate(${p.rotate}deg) scale(${p.scale})`,
              transitionDelay: `${p.delay}ms`,
            }}
          />
        ))}
      </svg>
    </div>
  );
}
