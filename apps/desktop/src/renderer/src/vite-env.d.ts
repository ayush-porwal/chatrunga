declare module "*.css";

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.mp3" {
  const src: string;
  export default src;
}

declare module "*.ogg" {
  const src: string;
  export default src;
}

declare module "*.js?url" {
  const src: string;
  export default src;
}

declare module "*.wasm?url" {
  const src: string;
  export default src;
}
