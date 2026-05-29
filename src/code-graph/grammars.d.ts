/**
 * Ambient type declarations for the native tree-sitter grammar packages.
 *
 * `tree-sitter-typescript` and `tree-sitter-javascript` ship native bindings
 * (`bindings/node`) without `.d.ts` files, so we declare their shape here. Each
 * grammar export is a tree-sitter `Language` object accepted by
 * `Parser.setLanguage`.
 */

declare module "tree-sitter-typescript" {
  import type Parser from "tree-sitter";
  const grammars: { typescript: Parser.Language; tsx: Parser.Language };
  export = grammars;
}

declare module "tree-sitter-javascript" {
  import type Parser from "tree-sitter";
  const javascript: Parser.Language;
  export = javascript;
}
