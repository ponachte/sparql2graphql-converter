import { RawRDF, Resource } from "../types";
import { ComunicaDataFactory } from "@comunica/types";
import * as RDF from "@rdfjs/types";
import { getLogger } from "../utils/logger";
import { BindingsFactory, Bindings } from "@comunica/utils-bindings-factory"; 

export class ResponseMapper {
  private context: string[] = [];
  private varMap: Record<string, string> = {};
  private filterMap: Record<string, RawRDF> = {};
  private typeMap: Record<string, string> = {};

  public addContext(ctx: string): void {
    this.context.push(ctx);
  }

  public removeContext(): void {
    this.context.pop();
  }

  private getContext(): string {
    return this.context.join("_");
  }

  public addVarMapping(sparqlVar: string, type: string, field?: string) {
    if (field) {
      this.varMap[sparqlVar] = this.getContext() + "_" + field;
      this.typeMap[this.getContext() + "_" + field] = type;
    } else {
      this.varMap[sparqlVar] = this.getContext();
      this.typeMap[this.getContext()] = type;
    }
    
  }

  public addFilterMapping(value: RawRDF): void {
    this.filterMap[this.getContext() + "__rawRDF"] = value;
  }

  public dataToBindings(
    data: any,
    variables: RDF.Variable[],
    dataFactory: ComunicaDataFactory,
    bindingsFactory: BindingsFactory, 
    prefix = ''
  ): Bindings[] {
    function recurse(value: any, keyPrefix: string): Resource[] {

      // Primitive → single resource
      if (typeof value !== 'object' || value === null) {
        return [{ [keyPrefix]: value }];
      }

      // Array → branch resources
      if (Array.isArray(value)) {
        const results: Resource[] = [];

        for (const el of value) {
          const sub = recurse(el, keyPrefix);
          results.push(...sub);
        }

        return results;
      }

      // Object → combine fields
      let resources: Resource[] = [{}];

      for (const [key, val] of Object.entries(value)) {
        const fullKey = keyPrefix ? `${keyPrefix}_${key}` : key;

        let fieldResources: Resource[];

        if (key === '_rawRDF' && typeof val === 'object' && val !== null) {
          fieldResources = [{ [fullKey]: <RawRDF>val }];
        } else {
          fieldResources = recurse(val, fullKey);
        }

        // Cartesian product with existing resources
        const next: Resource[] = [];

        for (const base of resources) {
          for (const add of fieldResources) {
            next.push({ ...base, ...add });
          }
        }

        resources = next;
      }

      return resources;
    }

    return recurse(data, prefix)
      .map(r => this.resourceToBindings(r, variables, dataFactory, bindingsFactory))
      .filter((b): b is Bindings => b !== undefined);
  }

  private resourceToBindings(
    resource: Resource, 
    variables: RDF.Variable[],
    dataFactory: ComunicaDataFactory,
    bindingsFactory: BindingsFactory,
  ): Bindings | undefined {
    getLogger().debug("Resource: ", JSON.stringify(resource, null, 2));
    const bindings: Record<string, RDF.Term> = {};

    // --- Filter resources based on filterMap ---
    for (const filterId of Object.keys(this.filterMap)) {
      const filterValue: RawRDF = this.filterMap[filterId];
      const resourceValue = <RawRDF> resource[filterId];

      if (filterValue['@id']) {
        if (resourceValue['@id'] !== filterValue['@id']) {
          // Doesn't match, skip resource
          return undefined;
        }
      } else if (filterValue['@type'] && filterValue['@value'] && (
        resourceValue['@value'] !== filterValue['@value'] ||
          resourceValue['@type'] !== filterValue['@type']
      )) {
        // Doesn't match, skip resource
        return undefined;
      }
    }

    // --- Convert resource values to RDF terms ---
    for (const variable of variables) {
      const varName = variable.value;
      const value = resource[this.varMap[varName]];
      const type = this.typeMap[this.varMap[varName]];
      getLogger().debug(`Variable ${varName} maps to ${this.varMap[varName]} = ${value} with type ${type}`);
      bindings[varName] = termFromValue(value, type, dataFactory);
    }

    return bindingsFactory.bindings(
      Object.entries(bindings).map(([key, term]) => [dataFactory.variable(key), term]));
  }
}

function termFromValue(value: any, type: string, dataFactory: RDF.DataFactory): RDF.Term {
  const XSD = 'http://www.w3.org/2001/XMLSchema#';

  if (type === "ID") {
    return dataFactory.namedNode(value);
  }

  if (type === "BoxedLiteral") {
    const valueType = dataFactory.namedNode(value['@type']);
    return dataFactory.literal(value['@value'], valueType);
  }

  if (type === "RDFNode") {
    if (value['@id']) {
      return dataFactory.namedNode(value['@id']);
    } else if (value['@value'] && value['@type']) {
      const valueType = dataFactory.namedNode(value['@type']);
      return dataFactory.literal(value['@value'], valueType);
    }
  }

  if (type === "Int") {
    return dataFactory.literal(value, dataFactory.namedNode(`${XSD}integer`));
  }

  if (type === "Float") {
    // TODO xsd:float xsd:decimal xsd:double
    return dataFactory.literal(value, dataFactory.namedNode(`${XSD}decimal`));
  }

  if (type === 'Boolean') {
    return dataFactory.literal(
      value ? 'true' : 'false',
      dataFactory.namedNode(`${XSD}boolean`),
    );
  }

  if (type === "DateTime") {
    return dataFactory.literal(value, dataFactory.namedNode(`${XSD}dateTime`));
  }

  if (type === "Date") {
    return dataFactory.literal(value, dataFactory.namedNode(`${XSD}date`));
  }

  if (type === "Time") {
    return dataFactory.literal(value, dataFactory.namedNode(`${XSD}time`));
  }

  // Default string
  return dataFactory.literal(value.toString(), dataFactory.namedNode(`${XSD}string`));
}