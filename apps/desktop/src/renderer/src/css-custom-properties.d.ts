import "react";

declare module "react" {
  interface CSSProperties {
    /** CSS custom properties (`--name`), which React sets as written. */
    [property: `--${string}`]: string | number | undefined;
  }
}
