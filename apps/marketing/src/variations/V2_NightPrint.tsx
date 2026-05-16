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
 * Variation 2 — Night print
 * The broadside in dark mode. Ink-black paper, bone text, deep-moss plates.
 * White knight on dark backgrounds. Same structure as V1, simpler captions.
 */

const BONE = "#efece4";
const MOSS = "#8fb66f";
const MOSS_DEEP = "#5e8a48";
const AMBER = "#e2b56b";

export function V2NightPrint() {
  return (
    <div className="min-h-screen bg-[#0d0f11] text-[#efece4]">
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

          {/* Knight on deep-moss plate */}
          <div className="relative self-stretch">
            <div className="relative h-full min-h-[300px] border-2 border-[#efece4] bg-[#5e8a48]">
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

      {/* Screenshot */}
      <section className="border-b-2 border-[#efece4]">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="mb-6 grid grid-cols-[auto_1fr] items-end gap-4 font-mono text-[12px] uppercase tracking-[0.14em]">
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#8fb66f]" />
              Fig. 01 — the studio
            </span>
            <span className="h-[2px] bg-[#efece4]" aria-hidden />
          </div>
          <div className="relative border-2 border-[#efece4] bg-[#efece4] p-3">
            <CornerMark className="-top-[5px] -left-[5px]" color={MOSS} />
            <CornerMark className="-top-[5px] -right-[5px]" color={AMBER} />
            <CornerMark className="-bottom-[5px] -left-[5px]" color={AMBER} />
            <CornerMark className="-bottom-[5px] -right-[5px]" color={MOSS} />
            <MacFrame tone="dark" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-b-2 border-[#efece4]">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="mb-12 text-[56px] font-extrabold leading-none tracking-[-0.02em] md:text-[80px]">
            What's in <span className="italic text-[#8fb66f]">the box</span>.
          </h2>
          <div className="grid divide-y-2 divide-[#efece4] border-y-2 border-[#efece4] md:grid-cols-2 md:divide-x-2 md:divide-y-0">
            {FEATURES.map((f, i) => {
              const accents = [MOSS, AMBER, BONE, MOSS_DEEP];
              const accent = accents[i % accents.length];
              return (
                <article key={f.title} className="relative p-8">
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 h-1 w-full"
                    style={{ background: accent }}
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
                  <h3 className="mb-3 text-[28px] font-bold leading-tight tracking-tight">
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

function CornerMark({ className = "", color = "#8fb66f" }: { className?: string; color?: string }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute h-2.5 w-2.5 border-2 ${className}`}
      style={{ borderColor: color }}
    />
  );
}
