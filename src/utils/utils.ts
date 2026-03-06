import * as RDF from "@rdfjs/types"
import { Algebra } from "sparqlalgebrajs";
import {
  TreeNode,
  Trees
} from "../types";
import { getLogger } from "./logger";
import { GraphQLField, GraphQLNamedType, GraphQLObjectType, GraphQLSchema, Kind } from "graphql";

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