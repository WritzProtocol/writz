export function BorderBeam() {
  return (
    <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
      <div
        className="absolute w-24 h-24 blur-xl border-beam"
        style={{
          background: "color-mix(in oklab, var(--accent) 30%, transparent)",
          offsetPath: "rect(0 100% 100% 0 round 16px)",
        }}
      />
    </div>
  );
}
