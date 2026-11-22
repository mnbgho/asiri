// The suite runs under vitest in node, but the build's type
// check carries no @types/node. The accessibility checks read
// two source files from disk; this declares exactly that
// surface and nothing more.
declare module "node:fs" {
  export function readFileSync(path: URL, encoding: string): string;
}
