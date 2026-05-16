import { APP_SCREENSHOT } from "./assets";

type Tone = "light" | "dark";

type Props = {
  src?: string;
  alt?: string;
  tone?: Tone;
  className?: string;
  /** Slight perspective tilt for hero treatments. */
  tilt?: boolean;
};

/**
 * Self-contained MacBook mockup. CSS only — no image dependency for the chrome.
 * The screenshot goes inside the lid; if the file is missing, a neutral placeholder shows.
 */
export function MacFrame({
  src = APP_SCREENSHOT,
  alt = "Chaturanga running on macOS",
  tone = "dark",
  className = "",
  tilt = false
}: Props) {
  const lidBg = tone === "dark" ? "bg-[#1a1c1f]" : "bg-[#e7e4dd]";
  const lidBorder = tone === "dark" ? "border-white/10" : "border-black/10";
  const baseBg = tone === "dark" ? "bg-gradient-to-b from-[#2a2d31] to-[#1a1c1f]" : "bg-gradient-to-b from-[#d4d0c7] to-[#b5b1a8]";

  return (
    <div
      className={`relative w-full ${className}`}
      style={tilt ? { transform: "perspective(2400px) rotateX(6deg)" } : undefined}
    >
      {/* Lid */}
      <div className={`relative rounded-[18px] border ${lidBorder} ${lidBg} p-2 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.65),0_18px_40px_-20px_rgba(0,0,0,0.4)]`}>
        {/* Camera notch */}
        <div className="absolute left-1/2 top-2 z-10 flex h-2.5 w-24 -translate-x-1/2 items-center justify-center rounded-b-md bg-black/90">
          <div className="h-1 w-1 rounded-full bg-white/30" />
        </div>
        {/* Screen */}
        <div className="overflow-hidden rounded-[10px] border border-black/40 bg-black aspect-[16/10]">
          <img
            src={src}
            alt={alt}
            className="h-full w-full object-cover object-center"
            onError={(e) => {
              const target = e.currentTarget;
              target.style.display = "none";
              const sib = target.nextElementSibling as HTMLElement | null;
              if (sib) sib.style.display = "flex";
            }}
          />
          <div
            style={{ display: "none" }}
            className="h-full w-full items-center justify-center bg-gradient-to-br from-[#1a1c1f] via-[#111315] to-[#0b0c0d] p-6 text-center"
          >
            <p className="font-mono text-xs text-white/40">
              Drop your screenshot at <span className="text-white/70">apps/marketing/public/app-screenshot.png</span>
            </p>
          </div>
        </div>
      </div>
      {/* Base / hinge */}
      <div className="relative mx-auto h-3 w-[101%] -translate-y-[1px]">
        <div className={`h-3 w-full rounded-b-[14px] ${baseBg} shadow-[0_18px_24px_-12px_rgba(0,0,0,0.5)]`} />
        <div className="absolute left-1/2 top-0 h-1.5 w-32 -translate-x-1/2 rounded-b-md bg-black/30" />
      </div>
    </div>
  );
}
