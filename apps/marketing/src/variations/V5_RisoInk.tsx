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
 * Variation 5 — Riso ink press (dark)
 * The brodaside pulled off a Risograph drum onto dark paper. Halftone dot
 * pattern across the page, italic punchline printed in two slightly mis-
 * registered ink layers, screenshot taped down with paper-tape corners.
 */

const MOSS = "#8fb66f";
const MOSS_DEEP = "#5e8a48";
const AMBER = "#e2b56b";

export function V5RisoInk() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0d0f11] text-[#efece4]">
      {/* Halftone overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(239,236,228,0.7) 1.2px, transparent 1.4px)",
          backgroundSize: "5px 5px"
        }}
      />
      {/* Two ink puddles — like riso colour washes */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-40 -z-10 h-[460px] w-[460px] rounded-full bg-[#5e8a48] opacity-30 blur-[2px] mix-blend-screen"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-[620px] -z-10 h-[520px] w-[520px] rounded-full bg-[#e2b56b] opacity-25 blur-[2px] mix-blend-screen"
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
            className="border-2 border-[#efece4] bg-[#efece4] px-4 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-[#0d0f11] hover:bg-[#e2b56b]"
          >
            {CTA_PRIMARY} →
          </a>
        </div>
      </nav>

      <header className="border-b-2 border-[#efece4]">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-14 md:grid-cols-[1.4fr_1fr] md:py-20">
          <div>
            <div
              className="mb-7 inline-flex items-center gap-2 border-2 border-[#8fb66f] bg-transparent px-3 py-1 font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-[#8fb66f]"
              style={{ transform: "rotate(-3deg)" }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#8fb66f]" />
              {ALPHA_LABEL}
            </div>
            <h1 className="font-display tracking-[-0.02em]">
              <span className="block text-[36px] leading-[1] text-[#efece4]/85 md:text-[52px] lg:text-[64px]">
                A chess studio
              </span>
              {/* Two-layer mis-registered italic */}
              <span className="relative block leading-[0.95]">
                <span
                  aria-hidden
                  className="absolute left-0 top-0 block whitespace-nowrap text-[48px] italic text-[#e2b56b] md:text-[76px] lg:text-[96px]"
                  style={{ transform: "translate(5px, 5px)" }}
                >
                  for your desktop.
                </span>
                <span className="relative block whitespace-nowrap text-[48px] italic text-[#8fb66f] md:text-[76px] lg:text-[96px]">
                  for your desktop.
                </span>
              </span>
            </h1>
            <p className="mt-10 max-w-xl border-l-4 border-[#e2b56b] pl-5 text-[18px] leading-snug text-[#efece4]/80">
              {SUBTAG}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#download"
                className="border-2 border-[#efece4] bg-[#efece4] px-6 py-3 font-mono text-[13px] font-bold uppercase tracking-[0.12em] text-[#0d0f11] shadow-[4px_4px_0_0_#e2b56b] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_#e2b56b]"
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

          {/* Knight on a halftone moss plate, printed twice (mis-registered) */}
          <div className="relative self-stretch">
            <div className="relative h-full min-h-[300px] border-2 border-[#efece4] bg-[#5e8a48]">
              <div
                aria-hidden
                className="absolute inset-0 opacity-30 mix-blend-multiply"
                style={{
                  backgroundImage:
                    "radial-gradient(rgba(13,15,17,0.7) 1.2px, transparent 1.4px)",
                  backgroundSize: "8px 8px"
                }}
              />
              {/* Amber under-layer, offset */}
              <img
                aria-hidden
                src={KNIGHT_WHITE}
                className="absolute inset-0 m-auto h-56 w-56 opacity-60 mix-blend-screen md:h-72 md:w-72"
                style={{
                  filter: "sepia(1) saturate(4) hue-rotate(-25deg) brightness(1.1)",
                  transform: "translate(8px, 8px)"
                }}
                alt=""
              />
              {/* Ink top layer */}
              <img
                src={KNIGHT_WHITE}
                alt=""
                className="absolute inset-0 m-auto h-56 w-56 md:h-72 md:w-72"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Screenshot — tape strips */}
      <section className="border-b-2 border-[#efece4]">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mb-6 grid grid-cols-[auto_1fr] items-end gap-4 font-mono text-[12px] uppercase tracking-[0.14em]">
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#e2b56b]" />
              Pull no. 02 · Fig. 01
            </span>
            <span className="h-[2px] bg-[#efece4]" aria-hidden />
          </div>
          <div className="relative px-3">
            <Tape className="-left-2 -top-3" rot={-6} color={AMBER} />
            <Tape className="-right-2 -top-3" rot={5} color={MOSS} />
            <Tape className="-bottom-3 -left-2" rot={4} color={MOSS} />
            <Tape className="-bottom-3 -right-2" rot={-5} color={AMBER} />
            <div className="relative border-2 border-[#efece4] bg-[#0d0f11] p-3">
              <MacFrame tone="dark" />
            </div>
          </div>
        </div>
      </section>

      {/* Features — halftone-corner cards */}
      <section id="features" className="border-b-2 border-[#efece4]">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="mb-12 text-[56px] font-extrabold leading-none tracking-[-0.02em] md:text-[80px]">
            What's in <span className="italic text-[#8fb66f]">the box</span>.
          </h2>
          <div className="grid gap-x-8 gap-y-10 md:grid-cols-2">
            {FEATURES.map((f, i) => {
              const accents = [AMBER, MOSS, MOSS_DEEP, AMBER];
              const accent = accents[i];
              return (
                <article
                  key={f.title}
                  className="relative border-2 border-[#efece4] bg-[#0d0f11] p-7 shadow-[6px_6px_0_0_#efece4]"
                >
                  {/* Halftone corner block */}
                  <div
                    aria-hidden
                    className="absolute -right-px -top-px h-20 w-20"
                    style={{
                      background: accent,
                      WebkitMaskImage:
                        "radial-gradient(rgba(0,0,0,1) 1.2px, transparent 1.4px)",
                      WebkitMaskSize: "6px 6px",
                      maskImage:
                        "radial-gradient(rgba(0,0,0,1) 1.2px, transparent 1.4px)",
                      maskSize: "6px 6px"
                    }}
                  />
                  <div className="mb-5 font-mono text-[12px] uppercase tracking-[0.14em] text-[#efece4]/55">
                    <span
                      className="mr-2 inline-grid h-6 w-6 place-items-center rounded-sm border-2 border-[#efece4] text-[11px] font-bold text-[#0d0f11]"
                      style={{ background: accent }}
                    >
                      {i + 1}
                    </span>
                    / feature
                  </div>
                  <h3 className="mb-3 text-[26px] font-bold leading-tight tracking-tight">
                    {f.title}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-[#efece4]/75">{f.body}</p>
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
            className="border-2 border-[#0d0f11] bg-[#0d0f11] px-7 py-4 font-mono text-[14px] font-bold uppercase tracking-[0.14em] text-[#efece4] shadow-[6px_6px_0_0_#e2b56b]"
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
