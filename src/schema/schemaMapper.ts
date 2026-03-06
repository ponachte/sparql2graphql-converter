import { buildSchema, getNamedType, GraphQLID, isScalarType, GraphQLNonNull } from "graphql";
import { getCustomObjectTypes, getFieldPredicate, getTypeIRI, valueFromLiteral } from "../utils/utils";
import { Edge, TreeNode } from "../types";
import type * as RDF from "@rdfjs/types";
import type { GraphQLArgument, GraphQLField, GraphQLObjectType } from "graphql";
import { getLogger } from "../utils/logger";
import { ResponseMapper } from "../converter/responseMapper";
import { collectEdges, buildTrees } from "../utils/trees";

function resolveIRI(
  iri: string | undefined,
  fallback: string,
  schema: SchemaMapper
) {
  return iri ? schema.replaceSPARQLPrefix(iri) : schema.toSPARQLContext(fallback);
}

function filterFields(fields: FieldMapper[], node: TreeNode): FieldMapper[] {
  return fields.filter(field => {
    if (node.type && !field.withType(node.type)) return false;
    if (!field.withSubject(node.term)) return false;

    for (const [p, child] of Object.entries(node.children)) {
      if (!field.withPredicate(p, child)) return false;
    }

    return true;
  });
}

export class SchemaMapper {

  private subscriptionFields: FieldMapper[] = [];
  private queryFields: FieldMapper[] = [];

  private readonly types = new Map<string, TypeMapper>();
  private readonly prefixes: [string, string][];

  constructor(schemaSource: string, private readonly context: Record<string, string>) {

    this.prefixes = Object.entries(context);

    schemaSource = `
      scalar BoxedLiteral
      scalar RDFNode
      scalar DateTime
      scalar Date
      scalar Time
      ${schemaSource}
    `;

    const schema = buildSchema(schemaSource, { assumeValidSDL: true });

    const subType = schema.getSubscriptionType();
    const queryType = schema.getQueryType();

    if (!subType && !queryType) {
      throw new Error("Schema needs at least a Subscription or Query type");
    }

    for (const type of Object.values(getCustomObjectTypes(schema))) {
      const mapper = new TypeMapper(type, this);
      this.types.set(mapper.getIRI(), mapper);
    }

    if (subType)
      this.subscriptionFields = Object.values(subType.getFields())
        .map(f => FieldMapperFactory.map(f, this));

    if (queryType)
      this.queryFields = Object.values(queryType.getFields())
        .map(f => FieldMapperFactory.map(f, this));
  }

  supportsQuery(node: TreeNode) {
    return filterFields(this.queryFields, node);
  }

  supportsSubscription(node: TreeNode) {
    return filterFields(this.subscriptionFields, node);
  }

  getField(typeIRI: string, fieldIRI: string) {
    return this.types.get(typeIRI)?.getField(fieldIRI);
  }

  toGraphQLContext(value: string): string {
    for (const [prefix, ns] of this.prefixes) {
      if (value.startsWith(prefix + ":"))
        return `${prefix}_${value.slice(prefix.length + 1)}`;
      if (value.startsWith(ns))
        return `${prefix}_${value.slice(ns.length)}`;
    }

    throw new Error(`Missing predicate prefix in context: ${value}`);
  }

  toSPARQLContext(value: string): string {
    for (const [prefix, ns] of this.prefixes) {
      if (value.startsWith(prefix + "_"))
        return ns + value.slice(prefix.length + 1);
    }
    return value;
  }

  replaceSPARQLPrefix(value: string): string {
    for (const [prefix, ns] of this.prefixes) {
      if (value.startsWith(prefix + ":"))
        return ns + value.slice(prefix.length + 1);
    }
    return value;
  }

  calculatePossibleTrees(root: TreeNode): TreeNode[] {

    const edges = collectEdges(root);

    const combos = edges.reduce<Edge[][]>((combos, edge) => {

      const variants = this.edgeVariants(edge);
      if (!variants.length) return [];

      return combos.flatMap(c => variants.map(v => [...c, v]));

    }, [[]]);

    return combos
      .map(edges => buildTrees(edges))
      .filter(t => t.roots.length === 1)
      .map(t => t.roots[0]);
  }

  private getPredicateFields(pred: string) {

    const fields: FieldMapper[] = [];

    for (const type of this.types.values()) {
      for (const field of type.getFields().values()) {
        if (field.getIRI() === pred)
          fields.push(field);
      }
    }

    return fields;
  }

  private edgeVariants(edge: Edge): Edge[] {

    const fields = this.getPredicateFields(edge.predicate);

    const hasNormal = fields.some(f => !f.reversed);
    const hasReversed = fields.some(f => f.reversed);

    if (!hasNormal && !hasReversed) return [];

    const variants = [];

    if (hasNormal) variants.push(edge);

    if (hasReversed) {
      variants.push({
        subject: edge.object,
        predicate: edge.predicate,
        object: edge.subject
      });
    }

    return variants;
  }

  rep() {
    return {
      type: "schema",
      types: [...this.types.values()].map(t => t.rep()),
      query: this.queryFields.map(f => f.getName()),
      subscribe: this.subscriptionFields.map(f => f.getName())
    };
  }
}

export class TypeMapper {

  private readonly iri: string;
  private readonly fields = new Map<string, FieldMapper>();

  constructor(type: GraphQLObjectType, schema: SchemaMapper) {

    const typeIRI = getTypeIRI(type);
    this.iri = typeIRI
      ? schema.replaceSPARQLPrefix(typeIRI)
      : schema.toSPARQLContext(type.name);

    for (const field of Object.values(type.getFields())) {
      const mapper = FieldMapperFactory.map(field, schema);
      this.fields.set(mapper.getIRI(), mapper);
    }
  }

  getIRI() {
    return this.iri;
  }

  getField(iri: string) {
    return this.fields.get(iri);
  }

  getFields() {
    return this.fields;
  }

  rep() {
    return {
      type: this.iri,
      fields: [...this.fields.values()].map(f => f.rep())
    };
  }
}

interface FieldMapper {
  readonly reversed: boolean
  getName(): string
  getIRI(): string
  withPredicate(pred: string, node: TreeNode): boolean
  withType(type: RDF.Term): boolean
  withSubject(obj: RDF.Term): boolean
  toQuery(node: TreeNode, responseMapper: ResponseMapper): string
  rep(): object
}

abstract class BaseFieldMapper implements FieldMapper {

  protected field: GraphQLField<any, any, any>;
  protected fieldIRI: string;
  readonly reversed: boolean;

  constructor(field: GraphQLField<any, any, any>, schema: SchemaMapper) {

    this.field = field;

    const [iri, reversed] = getFieldPredicate(field);

    this.fieldIRI = resolveIRI(iri, field.name, schema);
    this.reversed = reversed;
  }

  getName() {
    return this.field.name;
  }

  getIRI() {
    return this.fieldIRI;
  }

  abstract withPredicate(pred: string, node: TreeNode): boolean;
  abstract withType(type: RDF.Term): boolean;
  abstract withSubject(obj: RDF.Term): boolean;
  abstract toQuery(node: TreeNode, responseMapper: ResponseMapper): string;
  abstract rep(): object;
}

class FieldMapperFactory {

  static map(field: GraphQLField<any, any, any>, schema: SchemaMapper): FieldMapper {

    const type = getNamedType(field.type);

    if (!isScalarType(type))
      return new TypeFieldMapper(field, type as GraphQLObjectType, schema);

    if (type.name === "RDFNode" || type.name === "BoxedLiteral")
      return new RawRDFFieldMapper(field, type.name, schema);

    return new ScalarFieldMapper(field, type.name, schema);
  }
}

export class ScalarFieldMapper extends BaseFieldMapper {

  constructor(
    field: GraphQLField<any, any, any>,
    private type: string,
    schema: SchemaMapper
  ) {
    super(field, schema);
  }

  withSubject(obj: RDF.Term) {

    if (obj.termType === "Variable")
      return true;

    if (this.type === "ID")
      return obj.termType === "NamedNode";

    return obj.termType === "Literal";
  }

  withPredicate() { return false; }

  withType() { return false; }

  toQuery(node: TreeNode, responseMapper: ResponseMapper) {

    responseMapper.addContext(this.field.name);

    let query = this.field.name;

    if (node.term.termType === "Variable")
      responseMapper.addVarMapping(node.term.value);

    else if (node.term.termType === "Literal")
      query += ` @filter(if: "${this.field.name}==${valueFromLiteral(node.term)}")`;

    responseMapper.removeContext();

    return query.trim();
  }

  rep() {
    return {
      scalar: this.type,
      reversed: this.reversed,
      graphql: this.getName(),
      sparql: this.getIRI()
    };
  }
}

export class RawRDFFieldMapper extends BaseFieldMapper {

  constructor(
    field: GraphQLField<any, any, any>,
    private type: string,
    schema: SchemaMapper
  ) {
    super(field, schema);
  }

  withSubject(obj: RDF.Term) {
    return obj.termType !== "NamedNode" || this.type === "RDFNode";
  }

  withPredicate() { return false; }

  withType() { return false; }

  toQuery(node: TreeNode, responseMapper: ResponseMapper) {

    responseMapper.addContext(this.field.name);

    let query = `${this.field.name} { _rawRDF }`;

    if (node.term.termType === "Variable")
      responseMapper.addVarMapping(node.term.value, "_rawRDF");

    else if (node.term.termType === "Literal")
      responseMapper.addFilterMapping({
        "@value": node.term.value,
        "@type": node.term.datatype.value
      });

    else if (node.term.termType === "NamedNode")
      responseMapper.addFilterMapping({ "@id": node.term.value });

    responseMapper.removeContext();

    return query;
  }

  rep() {
    return {
      rdf: this.type,
      reversed: this.reversed,
      graphql: this.getName(),
      sparql: this.getIRI()
    };
  }
}

export class TypeFieldMapper extends BaseFieldMapper {

  private fieldTypeIRI: string;
  private idArg?: GraphQLArgument;
  private idField?: GraphQLField<any, any, any>;

  constructor(
    field: GraphQLField<any, any, any>,
    fieldType: GraphQLObjectType,
    private schemaMapper: SchemaMapper
  ) {
    super(field, schemaMapper);

    const typeIRI = getTypeIRI(fieldType);

    this.fieldTypeIRI = typeIRI
      ? schemaMapper.replaceSPARQLPrefix(typeIRI)
      : schemaMapper.toSPARQLContext(fieldType.name);

    this.idArg = field.args.find(a =>
      getNamedType(a.type) === GraphQLID && a.name === "id"
    );

    if (!this.idArg) {
      this.idField = Object.values(fieldType.getFields())
        .find(f => getNamedType(f.type) === GraphQLID && f.name === "id");
    }
  }

  private id() {
    return this.idArg?.name ?? this.idField?.name;
  }

  withType(type: RDF.Term) {

    getLogger().debug(
      `type ${this.fieldTypeIRI} === ${type.value} ? ${this.fieldTypeIRI === type.value}`
    );

    return this.fieldTypeIRI === type.value;
  }

  withSubject(subj: RDF.Term) {

    if (subj.termType === "Variable")
      return !this.idArg || !(this.idArg.type instanceof GraphQLNonNull);

    return !!this.idArg || !!this.idField;
  }

  withPredicate(pred: string, node: TreeNode) {

    const field = this.schemaMapper.getField(this.fieldTypeIRI, pred);

    if (!field) return false;
    if (!field.withSubject(node.term)) return false;

    if (node.type && !field.withType(node.type))
      return false;

    for (const [p, child] of Object.entries(node.children)) {
      if (!field.withPredicate(p, child))
        return false;
    }

    return true;
  }

  toQuery(node: TreeNode, responseMapper: ResponseMapper) {

    responseMapper.addContext(this.field.name);

    let query = this.field.name;

    const id = this.id();

    if (Object.keys(node.children).length) {

      if (node.term.termType === "NamedNode")
        query += `(${id}: "${node.term.value}")`;

      query += " { ";

      if (node.term.termType === "Variable") {
        query += `${id} `;
        responseMapper.addVarMapping(node.term.value, id);
      }

      for (const [pred, child] of Object.entries(node.children)) {

        const field = this.schemaMapper.getField(this.fieldTypeIRI, pred)!;
        query += field.toQuery(child, responseMapper) + " ";
      }

      query += "}";

    } else if (node.term.termType === "Variable") {

      query += " { id }";
      responseMapper.addVarMapping(node.term.value, "id");

    } else if (node.term.termType === "Literal") {

      query += ` @filter(if: "${this.field.name}==${valueFromLiteral(node.term)}")`;

    } else if (node.term.termType === "NamedNode") {

      query += `(id: "${node.term.value}") { id }`;
    }

    responseMapper.removeContext();

    return query.trim();
  }

  rep() {
    return {
      type: this.fieldTypeIRI,
      reversed: this.reversed,
      graphql: this.getName(),
      sparql: this.getIRI()
    };
  }
}