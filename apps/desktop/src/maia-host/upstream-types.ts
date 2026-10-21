/**
 * Stands in for CSSLab's `src/types` module, which their vendored maia.ts imports `MaiaStatus`
 * from (vendor/csslab-maia/src/lib/engine/maia.ts). Their whole types tree isn't vendored for one
 * union: the Vite build and tsconfig.maia-host.json map `src/types` here.
 */
export type { MaiaHostStatus as MaiaStatus } from "./protocol";
