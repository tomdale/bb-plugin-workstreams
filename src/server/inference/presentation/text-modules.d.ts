/** Text files bundled as strings: esbuild's default loader for `.txt`. */
declare module "*.txt" {
  const text: string;
  export default text;
}
