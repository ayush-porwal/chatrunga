import { useEffect, useState } from "react";
import { Switcher } from "./shared/Switcher";
import { V1Broadside } from "./variations/V1_Broadside";
import { V2NightPrint } from "./variations/V2_NightPrint";
import { V3AmberLamp } from "./variations/V3_AmberLamp";
import { V4Pinboard } from "./variations/V4_Pinboard";
import { V5RisoInk } from "./variations/V5_RisoInk";

const VARIATIONS = [
  { id: 1, name: "Broadside", Component: V1Broadside },
  { id: 2, name: "Night print", Component: V2NightPrint },
  { id: 3, name: "Amber lamp", Component: V3AmberLamp },
  { id: 4, name: "Pinboard", Component: V4Pinboard },
  { id: 5, name: "Riso ink", Component: V5RisoInk }
] as const;

function readInitial(): number {
  const fromHash = parseInt(window.location.hash.replace("#v", ""), 10);
  if (fromHash >= 1 && fromHash <= VARIATIONS.length) return fromHash;
  return 1;
}

export function App() {
  const [current, setCurrent] = useState<number>(readInitial);

  useEffect(() => {
    function onHash() {
      const next = parseInt(window.location.hash.replace("#v", ""), 10);
      if (next >= 1 && next <= VARIATIONS.length) setCurrent(next);
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function setVariation(n: number) {
    setCurrent(n);
    window.location.hash = `v${n}`;
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }

  const active = VARIATIONS.find((v) => v.id === current) ?? VARIATIONS[0];
  const ActiveComponent = active.Component;

  return (
    <>
      <ActiveComponent />
      <Switcher current={current} total={VARIATIONS.length} onChange={setVariation} />
    </>
  );
}
