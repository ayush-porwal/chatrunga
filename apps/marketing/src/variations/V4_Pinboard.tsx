import { MacFrame } from "../shared/MacFrame";
import {
  ALPHA_LABEL,
  CTA_PRIMARY,
  CTA_SECONDARY,
  FEATURES,
  KNIGHT_WHITE,
  SUBTAG
} from "../shared/assets";

/**
 * Variation 4 — Pinboard
 * Dark wall, prints pinned to it. Each card sits at a small angle with
 * paper-tape corners holding it down. Borrows the tilt + tape ideas from the
 * original riso pull, keeps the broadside hero pattern.
 */

const MOSS = "#8fb66f";
const AMBER = "#e2b56b";

export function V4Pinboard() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0d0f11] text-[#efece4]">
      {/* Wall grain */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(239,236,228,0.4) 1px, transparent 1px)",
          backgroundSize: "5px 5px"
        }}
      />

      {/* Registration strip */}
      <div className="flex h-2 w-full border-b-2 border-[#efece4]">
        <span className="flex-1 bg-[#0d0f11]" />
        <span className="flex-1 bg-[#5e8a48]" />
        <span className="flex-1 bg-[#8fb66f]" />
        <span className="flex-1 bg-[#e2b56b]" />
        <span className="flex-1 bg-[#efece4]" />
      </div>

      <nav className="border-b-2 border-[#efece4]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-sm border-2 border-[#efece4] bg-[#5e8a48]">
              <img src={KNIGHT_WHITE} alt="" className="h-6 w-6" />
            </span>
            <span className="text-[16px] font-extrabold uppercase tracking-[0.06em]">
              Chaturanga
            </span>
          </div>
          <div className="hidden items-center gap-6 font-mono text-[12px] uppercase tracking-[0.1em] md:flex">
            <a href="#features" className="hover:text-[#8fb66f]">/ features</a>
          </div>
          <a
            href="#download"
            className="border-2 border-[#efece4] bg-[#efece4] px-4 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-[#0d0f11] hover:bg-[#8fb66f]"
          >
            {CTA_PRIMARY} →
          </a>
        </div>
      </nav>

      <header className="border-b-2 border-[#efece4]">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-14 md:grid-cols-[1.4fr_1fr] md:py-20">
          <div>
            <div
              className="mb-7 inline-flex items-center gap-2 border-2 border-[#efece4] bg-[#e2b56b] px-3 py-1 font-mono text-[12px] font-bold uppercase tracking-[0.18em] text-[#0d0f11] shadow-[3px_3px_0_0_#efece4]"
              style={{ transform: "rotate(-1.2deg)" }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#0d0f11]" />
              {ALPHA_LABEL}
            </div>
            <h1 className="font-display tracking-[-0.02em]">
              <span className="block text-[36px] leading-[1] text-[#efece4]/85 md:text-[52px] lg:text-[64px]">
                A chess studio
              </span>
              <span className="block whitespace-nowrap text-[48px] italic leading-[0.95] text-[#8fb66f] md:text-[76px] lg:text-[96px]">
                for your desktop.
              </span>
            </h1>
            <p className="mt-8 max-w-xl border-l-4 border-[#8fb66f] pl-5 text-[18px] leading-snug text-[#efece4]/75">
              {SUBTAG}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#download"
                className="border-2 border-[#efece4] bg-[#efece4] px-6 py-3 font-mono text-[13px] font-bold uppercase tracking-[0.12em] text-[#0d0f11] shadow-[4px_4px_0_0_#8fb66f] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_#8fb66f]"
              >
                {CTA_PRIMARY}
              </a>
              <a
                href="#features"
                className="border-2 border-[#efece4] bg-transparent px-6 py-3 font-mono text-[13px] font-bold uppercase tracking-[0.12em] text-[#efece4] hover:bg-[#efece4]/[0.07]"
              >
                {CTA_SECONDARY}
              </a>
            </div>
          </div>

          {/* Knight card — tilted, with paper-tape at top */}
          <div className="relative self-stretch px-2">
            <div
              className="relative h-full min-h-[300px] border-2 border-[#efece4] bg-[#5e8a48] shadow-[8px_8px_0_0_rgba(143,182,111,0.35)]"
              style={{ transform: "rotate(-2deg)" }}
            >
              <Tape className="-left-4 -top-4" rot={-12} color={AMBER} />
              <Tape className="-right-4 -top-4" rot={9} color={MOSS} />
              <div
                aria-hidden
                className="absolute inset-0 opacity-[0.22]"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(45deg, #0d0f11 0 2px, transparent 2px 14px)"
                }}
              />
              <img
                src={KNIGHT_WHITE}
                alt=""
                className="absolute inset-0 m-auto h-56 w-56 md:h-72 md:w-72"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Screenshot — taped to the wall, slightly tilted */}
      <section className="border-b-2 border-[#efece4]">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mb-6 grid grid-cols-[auto_1fr] items-end gap-4 font-mono text-[12px] uppercase tracking-[0.14em]">
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#e2b56b]" />
              Taped to the wall · Fig. 01
            </span>
            <span className="h-[2px] bg-[#efece4]" aria-hidden />
          </div>
          <div className="relative px-3" style={{ transform: "rotate(-0.4deg)" }}>
            <Tape className="-left-2 -top-3" rot={-7} color={AMBER} />
            <Tape className="-right-2 -top-3" rot={6} color={MOSS} />
            <Tape className="-bottom-3 -left-2" rot={5} color={MOSS} />
            <Tape className="-bottom-3 -right-2" rot={-6} color={AMBER} />
            <div className="relative border-2 border-[#efece4] bg-[#0d0f11] p-3">
              <MacFrame tone="dark" />
            </div>
          </div>
        </div>
      </section>

      {/* Features — tilted index cards on the wall */}
      <section id="features" className="border-b-2 border-[#efece4]">
        <div className="mx-auto max-w-6xl px-6 pb-20 pt-14">
          <h2 className="mb-12 text-[56px] font-extrabold leading-none tracking-[-0.02em] md:text-[80px]">
            What's in <span className="italic text-[#8fb66f]">the box</span>.
          </h2>
          <div className="grid gap-x-8 gap-y-12 md:grid-cols-2">
            {FEATURES.map((f, i) => {
              const tapes: { color: string; rot: number; pos: string }[][] = [
                [
                  { color: AMBER, rot: -10, pos: "-left-3 -top-3" },
                  { color: MOSS, rot: 7, pos: "-right-3 -top-3" }
                ],
                [
                  { color: MOSS, rot: 8, pos: "-left-3 -top-3" },
                  { color: AMBER, rot: -11, pos: "-right-3 -top-3" }
                ],
                [
                  { color: AMBER, rot: -6, pos: "-right-3 -top-3" },
                  { color: MOSS, rot: 10, pos: "-left-3 -bottom-3" }
                ],
                [
                  { color: MOSS, rot: -8, pos: "-left-3 -top-3" },
                  { color: AMBER, rot: 5, pos: "-right-3 -bottom-3" }
                ]
              ];
              const rotations = [-1.2, 0.8, -0.6, 1.0];
              const accents = [MOSS, AMBER, MOSS, AMBER];
              return (
                <article
                  key={f.title}
                  className="relative border-2 border-[#0d0f11] bg-[#efece4] p-7 text-[#0d0f11] shadow-[8px_8px_0_0_rgba(143,182,111,0.45)]"
                  style={{ transform: `rotate(${rotations[i]}deg)` }}
                >
                  {tapes[i].map((t, j) => (
                    <Tape key={j} className={t.pos} rot={t.rot} color={t.color} />
                  ))}
                  <div className="mb-5 font-mono text-[12px] uppercase tracking-[0.14em] text-[#0d0f11]/60">
                    <span
                      className="mr-2 inline-grid h-6 w-6 place-items-center rounded-sm border-2 border-[#0d0f11] text-[11px] font-bold text-[#0d0f11]"
                      style={{ background: accents[i] }}
                    >
                      {i + 1}
                    </span>
                    / feature
                  </div>
                  <h3 className="mb-3 text-[26px] font-bold leading-tight tracking-tight">
                    {f.title}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-[#0d0f11]/75">{f.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Download */}
      <section
        id="download"
        className="border-b-2 border-[#efece4] bg-[#efece4] text-[#0d0f11]"
      >
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 md:grid-cols-[1fr_auto] md:items-center">
          <h3 className="text-[48px] font-extrabold leading-none tracking-[-0.02em] md:text-[64px]">
            Sit down at <span className="text-[#5e8a48]">the board</span>.
          </h3>
          <a
            href="#"
            className="border-2 border-[#0d0f11] bg-[#0d0f11] px-7 py-4 font-mono text-[14px] font-bold uppercase tracking-[0.14em] text-[#efece4] shadow-[6px_6px_0_0_#8fb66f]"
          >
            {CTA_PRIMARY} →
          </a>
        </div>
      </section>

      <footer>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 font-mono text-[12px] uppercase tracking-[0.14em] text-[#efece4]/55">
          <span>© 2026 Chaturanga</span>
          <span>{ALPHA_LABEL}</span>
        </div>
      </footer>
    </div>
  );
}

function Tape({
  className = "",
  rot = 0,
  color
}: {
  className?: string;
  rot?: number;
  color: string;
}) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute z-10 h-6 w-20 ${className}`}
      style={{
        background: color,
        opacity: 0.85,
        transform: `rotate(${rot}deg)`,
        boxShadow: "0 2px 0 rgba(0,0,0,0.25)"
      }}
    />
  );
}
