import * as RDF from "@rdfjs/types";

export interface RawRDF {
  '@id'?: string;
  '@value'?: string;
  '@type'?: string;
}

export interface TreeNode {
  term: RDF.Term;
  type?: RDF.Term;
  children: Record<string, TreeNode>;
}

export interface Trees {
  roots: TreeNode[];
  nodes: Record<string, TreeNode>;
}

export interface ILogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}