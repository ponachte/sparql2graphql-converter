import { buildSchema } from "graphql";
import { getCustomObjectTypes, getFieldPredicate, getTypeIRI, valueFromLiteral } from '../utils/utils';
import { RawRDF, TreeNode } from '../types';
import type * as RDF from '@rdfjs/types';
import type { GraphQLArgument, GraphQLField, GraphQLObjectType } from 'graphql';
import { getNamedType, GraphQLID, isScalarType, GraphQLNonNull } from 'graphql';
import { getLogger } from '../utils/logger';
import { ResponseMapper } from "../converter/responseMapper";

export class SchemaMapper {

  private readonly subscriptionFields: FieldMapper[] = [];
  private readonly queryFields: FieldMapper[] = [];
  private readonly context: Record<string, string>;

  private readonly types: Map<string, TypeMapper>;

  constructor(schemaSource: string, schemaContext: Record<string, string>) {
    this.context = schemaContext;
    schemaSource = `
    scalar BoxedLiteral
    scalar RDFNode
    scalar DateTime
    scalar Date
    scalar Time
    ${schemaSource}
    `;
    const schema = buildSchema(schemaSource, {
      assumeValidSDL: true,
    });

    const subcriptionType = schema.getSubscriptionType();
    const queryType = schema.getQueryType();
    if (!subcriptionType && !queryType) {
      throw new Error("Schema needs atleast a Subcription or Query type defined");
    }

    this.types = new Map<string, TypeMapper>();
    for (const type of Object.values(getCustomObjectTypes(schema))) {
      const mapper = new TypeMapper(type, this);
      this.types.set(mapper.getIRI(), mapper);
    }

    if (subcriptionType) {
      this.subscriptionFields = Object.values(subcriptionType.getFields()).map(field => FieldMapperFactory.map(field, this));
    }
    if (queryType) {
      this.queryFields = Object.values(queryType.getFields()).map(field => FieldMapperFactory.map(field, this));
    }
  }

  public supportsQuery(node: TreeNode): FieldMapper[] {
    return filterFields(this.queryFields, node);
  }

  public supportsSubscription(node: TreeNode): FieldMapper[] {
    return filterFields(this.subscriptionFields, node);
  }

  public getField(typeIRI: string, fieldIRI: string): FieldMapper | undefined {
    return this.types.get(typeIRI)?.getField(fieldIRI);
  }

  public toGraphQLContext(sparqlValue: string): string {
    for (const [ prefix, ns ] of Object.entries(this.context)) {
      if (sparqlValue.startsWith(prefix + ":")) {
        const suffix = sparqlValue.slice(prefix.length + 1);
        return `${prefix}_${suffix}`;
      }
      if (sparqlValue.startsWith(ns)) {
        const suffix = sparqlValue.slice(ns.length);
        return `${prefix}_${suffix}`;
      }
    }

    throw new Error(`Missing predicate prefix in context: ${sparqlValue}`);
  }

  public toSPARQLContext(graphqlValue: string): string {
    for (const [ prefix, ns ] of Object.entries(this.context)) {
      if (graphqlValue.startsWith(prefix + "_")) {
        const suffix = graphqlValue.slice(prefix.length + 1);
        return `${ns}${suffix}`;
      }
    }
    return graphqlValue;
  }

  public replaceSPARQLPrefix(sparqlValue: string): string {
    for (const [ prefix, ns ] of Object.entries(this.context)) {
      if (sparqlValue.startsWith(prefix + ":")) {
        const suffix = sparqlValue.slice(prefix.length + 1);
        return `${ns}${suffix}`;
      }
    }
    return sparqlValue;
  }

  public rep() {
    return {
      "type": "schema",
      "types": [...this.types.values()].map(m => m.rep()),
      "query": this.queryFields.map(m => m.getName()),
      "subscribe": this.subscriptionFields.map(m => m.getName())
    };
  }
}

export class TypeMapper {

  private readonly iri: string;
  private readonly fields: Map<string, FieldMapper>;

  constructor(type: GraphQLObjectType<any, any>, schemaMapper: SchemaMapper) {
    const typeIRI = getTypeIRI(type);
    if (typeIRI) {
      // Replace prefixes
      this.iri = schemaMapper.replaceSPARQLPrefix(typeIRI);
    } else {
      // set type IRI to field type name in sparql context
      this.iri = schemaMapper.toSPARQLContext(type.name);
    }

    this.fields = new Map<string, FieldMapper>();
    for (const field of Object.values(type.getFields())) {
      const mapper = FieldMapperFactory.map(field, schemaMapper);
      this.fields.set(mapper.getIRI(), mapper);
    }
  }

  public getIRI(): string {
    return this.iri;
  }

  public getField(iri: string): FieldMapper | undefined {
    return this.fields.get(iri);
  }

  public rep() {
    return {
      "type": this.getIRI(),
      "fields": [...this.fields.values()].map(m => m.rep()),
    };
  }
}

interface FieldMapper {
  getName(): string
  getIRI(): string
  withPredicate(pred: string, node: TreeNode): boolean
  withType(type: RDF.Term): boolean
  withObject(obj: RDF.Term): boolean
  toQuery(node: TreeNode, responseMapper: ResponseMapper): string
  rep(): object
}

class FieldMapperFactory {
  static map(field: GraphQLField<any, any, any>, schemaMapper: SchemaMapper): FieldMapper {
    const fieldType = <GraphQLObjectType>getNamedType(field.type);
    if (isScalarType(fieldType)) {
      if (fieldType.name === 'RDFNode' || fieldType.name === 'BoxedLiteral') {
        return new RawRDFFieldMapper(field, fieldType.name, schemaMapper);
      }
      return new ScalarFieldMapper(field, fieldType.name, schemaMapper);
    }
    return new TypeFieldMapper(field, fieldType, schemaMapper);
  }
}

export class ScalarFieldMapper implements FieldMapper {

  private readonly field: GraphQLField<any, any, any>;
  private readonly type: string
  private readonly fieldIRI: string;
  private readonly reversed: boolean;

  constructor(field: GraphQLField<any, any, any>, type: string, schemaMapper: SchemaMapper) {
    this.field = field;
    this.type = type;

    // --- Field Predicate --- //
    // parse @predicate decorator
    const [ fieldIRI, reversed ] = getFieldPredicate(this.field);
    if (fieldIRI) {
      // Replace prefixes
      this.fieldIRI = schemaMapper.replaceSPARQLPrefix(fieldIRI);
    } else {
      // set field IRI to field name in sparql context
      this.fieldIRI = schemaMapper.toSPARQLContext(this.field.name);
    }
    this.reversed = reversed;
  }
  
  getName(): string {
    return this.field.name;
  }

  getIRI(): string {
    return this.fieldIRI;
  }

  withObject(obj: RDF.Term): boolean {
    getLogger().debug(`Field ${this.field.name} Object Check`);
    if (obj.termType === "Variable") {
      getLogger().debug(`\t${obj.termType} ${obj.value} ? true`);
      return true;
    }
    if (this.type == "ID") {
      getLogger().debug(`\t${obj.termType} ${obj.value} ? ${obj.termType === "NamedNode"}`);
      return obj.termType === "NamedNode";
    }
    getLogger().debug(`\t${obj.termType} ${obj.value} ? ${obj.termType === "Literal"}`);
    return obj.termType === "Literal";
  }

  withPredicate(pred: string, node: TreeNode): boolean {
    return false;
  }

  withType(type: RDF.Term): boolean {
    return false;
  }

  toQuery(node: TreeNode, responseMapper: ResponseMapper): string {
    let query = this.field.name;

    if (node.term.termType === 'Variable') {
      responseMapper.addVarMapping(node.term.value, this.field.name);
    } else if (node.term.termType === 'Literal') {
      query += ` @filter(if: "${this.field.name}==${valueFromLiteral(node.term)}") `;
    }

    return query.replaceAll(/\s+/ug, ' ').trim();
  }

  public rep() {
    return {
      "scalar type": this.type,
      "reversed": this.reversed,
      "graphql": this.getName(),
      "sparql": this.getIRI()
    };
  }
  
}

export class RawRDFFieldMapper implements FieldMapper {

  private readonly field: GraphQLField<any, any, any>;
  private readonly type: string;
  private readonly fieldIRI: string;
  private readonly reversed: boolean;

  constructor(field: GraphQLField<any, any, any>, type: string, schemaMapper: SchemaMapper) {
    this.field = field;
    this.type = type;

    // --- Field Predicate --- //
    // parse @predicate decorator
    const [ fieldIRI, reversed ] = getFieldPredicate(this.field);
    if (fieldIRI) {
      // Replace prefixes
      this.fieldIRI = schemaMapper.replaceSPARQLPrefix(fieldIRI);
    } else {
      // set field IRI to field name in sparql context
      this.fieldIRI = schemaMapper.toSPARQLContext(this.field.name);
    }
    this.reversed = reversed;
  }
  
  getName(): string {
    return this.field.name;
  }

  getIRI(): string {
    return this.fieldIRI;
  }

  withObject(obj: RDF.Term): boolean {
    if (obj.termType === "NamedNode") {
      return this.type === 'RDFNode';
    }
    return true;
  }

  withPredicate(pred: string, node: TreeNode): boolean {
    return false;
  }

  withType(type: RDF.Term): boolean {
    return false;
  }

  toQuery(node: TreeNode, responseMapper: ResponseMapper): string {
    let query = this.field.name;

    if (node.term.termType === 'Variable') {
      query += ' { _rawRDF } ';
      responseMapper.addVarMapping(node.term.value, `${this.field.name}__rawRDF`);
    } else if (node.term.termType === 'Literal') {
      query += ' { _rawRDF } ';
      responseMapper.addFilterMapping(`${this.field.name}__rawRDF`, {
        '@value': node.term.value,
        '@type': node.term.datatype.value,
      });
    } else if (node.term.termType === 'NamedNode') {
      query += ' { _rawRDF } ';
      responseMapper.addFilterMapping(`${this.field.name}__rawRDF`, {
        '@id': node.term.value,
      });
    }

    return query.replaceAll(/\s+/ug, ' ').trim();
  }

  public rep() {
    return {
      "rdf type": this.type,
      "reversed": this.reversed,
      "graphql": this.getName(),
      "sparql": this.getIRI()
    };
  }
  
}

export class TypeFieldMapper implements FieldMapper {
  private readonly field: GraphQLField<any, any, any>;
  private readonly fieldTypeIRI: string;
  private readonly fieldIRI: string;
  private readonly reverse: boolean;
  private readonly idArg: GraphQLArgument | undefined;
  private readonly idField: GraphQLField<any, any, any> | undefined;

  private readonly schemaMapper: SchemaMapper;

  public constructor(field: GraphQLField<any, any, any>, fieldType: GraphQLObjectType, schemaMapper: SchemaMapper) {
    this.field = field;    

    // --- Field Type --- //
    // parse @class decorator
    const typeIRI = getTypeIRI(fieldType);
    if (typeIRI) {
      // Replace prefixes
      this.fieldTypeIRI = schemaMapper.replaceSPARQLPrefix(typeIRI);
    } else {
      // set type IRI to field type name in sparql context
      this.fieldTypeIRI = schemaMapper.toSPARQLContext(fieldType.name);
    }

    // --- Field Predicate --- //
    // parse @predicate decorator
    const [ fieldIRI, reverse ] = getFieldPredicate(this.field);
    if (fieldIRI) {
      // Replace prefixes
      this.fieldIRI = schemaMapper.replaceSPARQLPrefix(fieldIRI);
    } else {
      // set field IRI to field name in sparql context
      this.fieldIRI = schemaMapper.toSPARQLContext(this.field.name);
    }
    this.reverse = reverse;

    // --- ID Argument --- //
    this.idArg = field.args.find(arg => {
      return getNamedType(arg.type) === GraphQLID && arg.name === "id";
    });
    if (this.idArg === undefined && !isScalarType(fieldType)) {
      this.idField = Object.values(fieldType.getFields()).find(field => {
        return getNamedType(field.type) === GraphQLID && field.name === "id";
      });
    }
    this.schemaMapper = schemaMapper;
  }

  public getName(): string {
    return this.field.name
  }

  public getIRI(): string {
    return this.fieldIRI;
  }

  public id(): string | undefined {
    if (this.idArg !== undefined) {
      return this.idArg.name;
    }
    if (this.idField !== undefined) {
      return this.idField.name;
    }
  }

  public toQuery(node: TreeNode, responseMapper: ResponseMapper): string {
    let query = this.field.name;

    if (Object.keys(node.children).length > 0) {
      // Not a leaf node
      if (node.term.termType === 'NamedNode') {
        query += `(${this.id()}: "${node.term.value}")`;
      }

      query += ' { ';

      if (node.term.termType === 'Variable') {
        query += `${this.id()} `;
        responseMapper.addVarMapping(node.term.value, `${this.field.name}_${this.id()}`);
      }

      // Recursively add children
      for (let [ pred, child ] of Object.entries(node.children)) {
        const field = this.schemaMapper.getField(this.fieldTypeIRI!, pred)!;
        const childQuery = field.toQuery(child, responseMapper);

        query += `${childQuery} `;
      }

      query += '} ';
    } else if (node.term.termType === 'Variable') {
      query += ' { id } ';
      responseMapper.addVarMapping(node.term.value, `${this.field.name}_id`);
    } else if (node.term.termType === 'Literal') {
      query += ` @filter(if: "${this.field.name}==${valueFromLiteral(node.term)}") `;
    } else if (node.term.termType === 'NamedNode') {
      query += `(id: "${node.term.value}") { id } `;
    }

    return query.replaceAll(/\s+/ug, ' ').trim();
  }

  public withType(type: RDF.Term): boolean {
    getLogger().debug(`Field ${this.field.name} Type Check`);
    getLogger().debug(`\ttype ${this.fieldTypeIRI} === ${type.value} ? ${this.fieldTypeIRI === type.value}`);
    return this.fieldTypeIRI === type.value;
  }

  public withObject(subj: RDF.Term): boolean {
    if (subj.termType === 'Variable') {
      return !this.idArg || !(this.idArg.type instanceof GraphQLNonNull);
    }
    return this.idArg !== undefined || this.idField !== undefined;
  }

  public withPredicate(pred: string, node: TreeNode): boolean {
    getLogger().debug(`Field ${this.field.name} Predicate Check`);
    const field = this.schemaMapper.getField(this.fieldTypeIRI, pred);
    getLogger().debug(`\ttype ${this.fieldTypeIRI} has pred ${pred} ? ${!field ? false : true}`);
    if (!field) {
      return false;
    }

    // Check if this field accepts the node term
    if (!field.withObject(node.term)) {
      return false;
    }

    // Check if this field accepts the node type
    if (node.type && !field.withType(node.type)) {
      return false;
    }

    for (const [ child_pred, child_node ] of Object.entries(node.children)) {
      // Check if this field accepts the children terms
      if (!field.withPredicate(child_pred, child_node)) {
        return false;
      }
    }

    return true;
  }

  public rep() {
    return {
      "type": this.fieldTypeIRI,
      "reversed": this.reverse,
      "graphql": this.getName(),
      "sparql": this.getIRI(),
    };
  }
}

function filterFields(fields: FieldMapper[], node: TreeNode): FieldMapper[] {
  let filtered = [ ...fields ];

  if (node.type) {
    filtered = filtered.filter(field => field.withType(node.type!));
  }

  filtered = filtered.filter(field => field.withObject(node.term));

  for (const [ p, child ] of Object.entries(node.children)) {
    filtered = filtered.filter(field => field.withPredicate(p, child));
  }

  return filtered;
}