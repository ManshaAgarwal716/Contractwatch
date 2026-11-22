declare module "picomatch" {
  const picomatch: (
    pattern: string,
    options?: { dot?: boolean; basename?: boolean },
  ) => (path: string) => boolean;
  export default picomatch;
}
