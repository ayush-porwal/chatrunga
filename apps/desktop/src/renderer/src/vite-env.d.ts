declare module "*.css";

declare module "*.mp3" {
  const src: string;
  export default src;
}

declare module "*.css.gz?url" {
  const src: string;
  export default src;
}
