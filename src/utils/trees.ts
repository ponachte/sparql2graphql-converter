import { Algebra } from "sparqlalgebrajs";
import { TreeNode, Edge, Trees } from "../types";

const TYPE_PREDICATES = ["http://www.w3.org/1999/02/22-rdf-syntax-ns#type"];

export function convertOperation(operation: Algebra.Operation): TreeNode {
  // Extract patters from the operation
  const patterns = extractPatterns(operation);

  // Convert patterns to trees
  const trees = patternsToTrees(patterns);

  // Currently only queries consisting of one tree are supported
  if (trees.roots.length > 1) {
    throw new Error(`Multiple entrypoints found: ${trees.roots.length}`);
  }
  if (trees.roots.length <= 0) {
    throw new Error(`No entrypoints found`);
  }

  return trees.roots[0]
}

function extractPatterns(op: Algebra.Operation): Algebra.Pattern[] {
  switch (op.type) {
    case Algebra.types.PROJECT:
      return extractPatterns(op.input);
    case Algebra.types.BGP:
      return op.patterns;
    case Algebra.types.PATTERN:
      return [ op ];
    case Algebra.types.JOIN: {
      const patterns: Algebra.Pattern[] = [];
      for (const child of op.input) {
        patterns.push(...extractPatterns(child));
      }
      return patterns;
    }
    default:
      throw new Error(`Unsupported operation type: ${op.type}`);
  }
}

function patternsToTrees(patterns: Algebra.Pattern[]): Trees {
  const nodes: Record<string, TreeNode> = {};
  const roots: Record<string, TreeNode> = {};

  for (const pattern of patterns) {
    if (pattern.predicate.termType === 'Variable') {
      throw new Error(`Cannot convert queries with a variable predicate.`);
    }

    const subject = pattern.subject;
    const pred = pattern.predicate.value;
    const object = pattern.object;

    if (!nodes[subject.value]) {
      nodes[subject.value] = { term: subject, children: {}};
      roots[subject.value] = nodes[subject.value];
    }

    if (TYPE_PREDICATES.includes(pred)) {
      nodes[subject.value].type = object
    } else if (object.termType === 'Literal') {
      nodes[subject.value].children[pred] = { term: object, children: {}};
    } else {
      if (!nodes[object.value]) {
        nodes[object.value] = { term: object, children: {}};
      }
      nodes[subject.value].children[pred] = nodes[object.value];
    }

    if (roots[object.value]) {
      delete roots[object.value];
    }
  }

  return {
    roots: Object.values(roots),
    nodes,
  };
}

export function collectEdges(node: TreeNode, edges: Edge[] = [], visited = new Set<TreeNode>()): Edge[] {
  if (visited.has(node)) return edges;
  visited.add(node);

  for (const [pred, child] of Object.entries(node.children)) {
    edges.push({
      subject: node,
      predicate: pred,
      object: child,
    });

    collectEdges(child, edges, visited);
  }

  return edges;
}

export function buildTrees(edges: Edge[]): Trees {
  const nodes: Record<string, TreeNode> = {};
  const incoming = new Set<string>();

  const getNode = (node: TreeNode): TreeNode => {
    const key = node.term.value;

    if (!nodes[key]) {
      nodes[key] = {
        term: node.term,
        type: node.type,
        children: {},
      };
    }

    return nodes[key];
  };

  for (const edge of edges) {
    const s = getNode(edge.subject);
    const o = getNode(edge.object);

    s.children[edge.predicate] = o;
    incoming.add(o.term.value);
  }

  const roots = Object.values(nodes).filter(
    node => !incoming.has(node.term.value)
  );

  return { roots, nodes };
}