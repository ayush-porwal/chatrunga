import { MacFrame } from "../shared/MacFrame";
import {
  ALPHA_LABEL,
  CTA_PRIMARY,
  CTA_SECONDARY,
  FEATURES,
  KNIGHT_BLACK,
  SUBTAG
} from "../shared/assets";

/**
 * Variation 1 — Print broadside
 * Bone paper background, hard 2px rules, oversized type, mono captions.
 * Full product palette: moss green, amber, deep ink. The foundation that the
 * other four variants riff on.
 */

const INK = "#111315";
const MOSS = "#8fb66f";
const MOSS_DEEP = "#5e8a48";
const AMBER = "#e2b56b";
const FEATURE_COLORS = [MOSS_DEEP, AMBER, INK, MOSS_DEEP] as const;

export function V1Broadside() {
  return (
    <div className="min-h-screen bg-[#efece4] text-[#111315]">
      {/* Colour rail — print registration strip */}
      <div className="flex h-2 w-full border-b-2 border-[#111315]">
        <span className="flex-1 bg-[#111315]" />
        <span className="flex-1 bg-[#8fb66f]" />
        <span className="flex-1 bg-[#cfe3bd]" />
        <span className="flex-1 bg-[#e2b56b]" />
        <span className="flex-1 bg-[#efece4]" />
      </div>

      <nav className="border-b-2 border-[#111315] bg-[#efece4]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-sm border-2 border-[#111315] bg-[#8fb66f]">
              <img src={KNIGHT_BLACK} alt="" className="h-6 w-6" />
            </span>
            <span className="text-[16px] font-extrabold uppercase tracking-[0.06em]">
              Chaturanga
            </span>
          </div>
          <div className="hidden items-center gap-6 font-mono text-[12px] uppercase tracking-[0.1em] md:flex">
            <a href="#features">/ features</a>
          </div>
          <a
            href="#download"
            className="border-2 border-[#111315] bg-[#111315] px-4 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-[#efece4] transition-colors hover:bg-[#5e8a48]"
          >
            {CTA_PRIMARY} →
          </a>
        </div>
      </nav>

      <header className="border-b-2 border-[#111315]">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-14 md:grid-cols-[1.4fr_1fr] md:py-20">
          <div>
            {/* Alpha sticker, rotated like it was slapped on */}
            <div className="mb-7 inline-flex items-center gap-2 border-2 border-[#111315] bg-[#e2b56b] px-3 py-1 font-mono text-[12px] font-bold uppercase tracking-[0.18em] text-[#111315] shadow-[3px_3px_0_0_#111315]"
              style={{ transform: "rotate(-1.2deg)" }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#111315]" />
              {ALPHA_LABEL}
            </div>
            <h1 className="font-display tracking-[-0.02em]">
              <span className="block text-[36px] leading-[1] text-[#111315]/85 md:text-[52px] lg:text-[64px]">
                A chess studio
              </span>
              <span className="block whitespace-nowrap text-[48px] italic leading-[0.95] text-[#5e8a48] md:text-[76px] lg:text-[96px]">
                for your desktop.
              </span>
            </h1>
            <p className="mt-8 max-w-xl border-l-4 border-[#8fb66f] pl-5 text-[18px] leading-snug text-[#111315]/75">
              {SUBTAG}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#download"
                className="border-2 border-[#111315] bg-[#111315] px-6 py-3 font-mono text-[13px] font-bold uppercase tracking-[0.12em] text-[#efece4] shadow-[4px_4px_0_0_#8fb66f] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_#8fb66f]"
              >
                {CTA_PRIMARY}
              </a>
              <a
                href="#features"
                className="border-2 border-[#111315] bg-transparent px-6 py-3 font-mono text-[13px] font-bold uppercase tracking-[0.12em] text-[#111315] hover:bg-[#111315]/[0.06]"
              >
                {CTA_SECONDARY}
              </a>
            </div>
          </div>

          {/* Knight on a colour block — like a printer's plate */}
          <div className="relative self-stretch">
            <div className="relative h-full min-h-[300px] border-2 border-[#111315] bg-[#8fb66f]">
              <div
                aria-hidden
                className="absolute inset-0 opacity-[0.18]"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(45deg, #111315 0 2px, transparent 2px 14px)"
                }}
              />
              <img
                src={KNIGHT_BLACK}
                alt=""
                className="absolute inset-0 m-auto h-56 w-56 md:h-72 md:w-72"
              />
              <span className="absolute left-3 top-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#111315]/80">
                ♞ plate · moss
              </span>
              <span className="absolute bottom-3 right-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#111315]/80">
                no. 02 / 05
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Screenshot — framed as a printer's fig. plate with colour callouts */}
      <section className="border-b-2 border-[#111315] bg-[#efece4]">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="mb-6 grid grid-cols-[auto_1fr_auto] items-end gap-4 font-mono text-[12px] uppercase tracking-[0.14em]">
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#8fb66f]" />
              Fig. 01 — the studio
            </span>
            <span className="h-[2px] bg-[#111315]" aria-hidden />
            <span className="text-[#111315]/55">[ live screenshot ]</span>
          </div>
          <div className="relative border-2 border-[#111315] bg-[#111315] p-3">
            {/* Corner crop marks */}
            <CornerMark className="-top-[5px] -left-[5px]" />
            <CornerMark className="-top-[5px] -right-[5px]" />
            <CornerMark className="-bottom-[5px] -left-[5px]" />
            <CornerMark className="-bottom-[5px] -right-[5px]" />
            <MacFrame tone="dark" />
          </div>
          {/* Plate labels in three colours */}
          <div className="mt-6 grid gap-3 font-mono text-[11.5px] uppercase tracking-[0.12em] md:grid-cols-3">
            <PlateLabel color={MOSS} label="Channel 01" text="Stockfish · Lc0 · Maia — bundled, offline" />
            <PlateLabel color={AMBER} label="Channel 02" text="Move-by-move review with engine PVs" />
            <PlateLabel color={INK} label="Channel 03" text="Your library — PGN in & out" />
          </div>
        </div>
      </section>

      {/* Quote / breaker */}
      <section className="border-b-2 border-[#111315] bg-[#8fb66f]">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-14 md:grid-cols-[auto_1fr] md:items-center">
          <span className="font-display text-[120px] leading-none text-[#111315]/80">"</span>
          <p className="font-display text-[28px] leading-tight tracking-tight text-[#111315] md:text-[40px]">
            A chess studio you can keep open on the dock and come back to —
            the way you'd come back to a board on the kitchen table.
          </p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-b-2 border-[#111315] bg-[#efece4]">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="mb-12 grid items-end gap-6 md:grid-cols-[1fr_auto]">
            <h2 className="text-[56px] font-extrabold leading-none tracking-[-0.02em] md:text-[80px]">
              What's in <span className="italic text-[#5e8a48]">the box</span>.
            </h2>
            <p className="font-mono text-[12px] uppercase tracking-[0.16em] text-[#111315]/55">
              Four pieces · printed in one pass
            </p>
          </div>
          <div className="grid divide-y-2 divide-[#111315] border-y-2 border-[#111315] md:grid-cols-2 md:divide-x-2 md:divide-y-0">
            {FEATURES.map((f, i) => {
              const color = FEATURE_COLORS[i % FEATURE_COLORS.length];
              return (
                <article key={f.title} className="relative p-8">
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 h-1 w-full"
                    style={{ background: color }}
                  />
                  <div className="mb-5 flex items-baseline justify-between font-mono text-[12px] uppercase tracking-[0.14em] text-[#111315]/60">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="grid h-6 w-6 place-items-center rounded-sm border-2 border-[#111315] text-[11px] font-bold text-[#111315]"
                        style={{ background: color }}
                      >
                        {i + 1}
                      </span>
                      / feature
                    </span>
                    <span>plate · {color === INK ? "ink" : color === AMBER ? "amber" : "moss"}</span>
                  </div>
                  <h3 className="mb-3 text-[28px] font-bold leading-tight tracking-tight">
                    {f.title}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-[#111315]/75">{f.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Download band */}
      <section id="download" className="border-b-2 border-[#111315] bg-[#111315] text-[#efece4]">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="mb-3 font-mono text-[12px] uppercase tracking-[0.16em] text-[#8fb66f]">
              Last page
            </p>
            <h3 className="text-[48px] font-extrabold leading-none tracking-[-0.02em] md:text-[64px]">
              Sit down at <span className="text-[#e2b56b]">the board</span>.
            </h3>
          </div>
          <a
            href="#"
            className="border-2 border-[#efece4] bg-[#efece4] px-7 py-4 font-mono text-[14px] font-bold uppercase tracking-[0.14em] text-[#111315] shadow-[6px_6px_0_0_#8fb66f] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[8px_8px_0_0_#8fb66f]"
          >
            {CTA_PRIMARY} →
          </a>
        </div>
      </section>

      <footer className="bg-[#efece4]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 font-mono text-[12px] uppercase tracking-[0.14em] text-[#111315]/65">
          <span>© 2026 Chaturanga · {ALPHA_LABEL}</span>
          <span>Set in Inter & Instrument Serif. Printed in moss, amber, and ink.</span>
        </div>
      </footer>
    </div>
  );
}

function CornerMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute h-2.5 w-2.5 border-2 border-[#8fb66f] ${className}`}
    />
  );
}

function PlateLabel({
  color,
  label,
  text
}: {
  color: string;
  label: string;
  text: string;
}) {
  return (
    <div className="grid grid-cols-[14px_1fr] items-start gap-3 border-2 border-[#111315] bg-[#efece4] px-3 py-3">
      <span className="mt-1 h-3.5 w-3.5 border-2 border-[#111315]" style={{ background: color }} />
      <div>
        <span className="block text-[#111315]/55">{label}</span>
        <span className="block text-[#111315]">{text}</span>
      </div>
    </div>
  );
}
