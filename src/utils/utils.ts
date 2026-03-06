import * as RDF from "@rdfjs/types"
import { Algebra } from "sparqlalgebrajs";
import {
  TreeNode,
  Trees
} from "../types";
import { getLogger } from "./logger";
import { GraphQLField, GraphQLNamedType, GraphQLObjectType, GraphQLSchema, Kind } from "graphql";

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

export function getCustomObjectTypes(schema: GraphQLSchema): GraphQLObjectType[] {
  const typeMap = schema.getTypeMap();

  return Object.values(typeMap).filter((type): type is GraphQLObjectType => {
    // remove introspection types
    if (type.name.startsWith("__")) return false;

    // remove root operation types
    if (
      type === schema.getQueryType() ||
      type === schema.getMutationType() ||
      type === schema.getSubscriptionType()
    ) {
      return false;
    }

    return type instanceof GraphQLObjectType;
  });
}

export function getTypeIRI(type: GraphQLNamedType): string | undefined {
  const ast = type.astNode;
  if (!ast?.directives) return undefined;

  const classDirective = ast.directives.find(d => d.name.value === "class");
  if (!classDirective) return undefined;

  const iriArg = classDirective.arguments?.find(arg => arg.name.value === "iri");
  if (iriArg?.value?.kind === "StringValue") {
    return iriArg.value.value;
  }
  return undefined;
}

export function getFieldPredicate(field: GraphQLField<any, any, any>): [string | undefined, boolean] {
  const ast = field.astNode;
  if (!ast?.directives) return [ undefined, false ];

  const predicateDirective = ast.directives.find(d => d.name.value === "predicate");
  if (!predicateDirective) return [ undefined, false ];;

  const iriArg = predicateDirective.arguments?.find(arg => arg.name.value === "iri");
  let iriValue = undefined;
  if (iriArg?.value?.kind === "StringValue") {
    iriValue = iriArg.value.value;
  }

  const reverseArg = predicateDirective.arguments?.find(arg => arg.name.value === "reverse");
  let reverseValue = false;
  if (reverseArg?.value?.kind === "BooleanValue") {
    reverseValue = reverseArg.value.value
  }

  return [ iriValue, reverseValue ];
}

export function valueFromLiteral(term: RDF.Literal): string {
  const dt = term.datatype.value;

  // Common XSD numeric types
  const numericTypes = [
    'http://www.w3.org/2001/XMLSchema#integer',
    'http://www.w3.org/2001/XMLSchema#decimal',
    'http://www.w3.org/2001/XMLSchema#double',
    'http://www.w3.org/2001/XMLSchema#float',
  ];

  // Booleans
  const booleanType = 'http://www.w3.org/2001/XMLSchema#boolean';

  if (numericTypes.includes(dt) || booleanType.includes(dt)) {
    return term.value;
  }
  return `'${term.value}'`;
}