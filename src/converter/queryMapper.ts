import { Algebra, translate } from 'sparqlalgebrajs';
import { SchemaMapper } from '../schema/schemaMapper';
import { ResponseMapper } from './responseMapper';
import { convertOperation } from '../utils/trees';
import { getLogger } from '../utils/logger';
import { SubscriptionType } from '../types';

export class QueryMapper {

  private schemaMapper: SchemaMapper

  constructor(schema: string, context: Record<string, string>) {
    this.schemaMapper = new SchemaMapper(schema, context);
    getLogger().debug("With Schema: ", JSON.stringify(this.schemaMapper.rep(), null, 2));
  }

  public query(query: string): [string, ResponseMapper][] {
    const operation = translate(query);
    return this.queryOperation(operation);
  }

  public subscribe(query: string, type?: SubscriptionType): [string, ResponseMapper][] {
    const operation = translate(query);
    return this.subscribeOperation(operation, type);
  }

  public queryOperation(operation: Algebra.Operation): [string, ResponseMapper][] {
    const results: [string, ResponseMapper][] = [];

    // Convert operation to tree
    const tree = convertOperation(operation);

    // Expand the current tree into all possible trees (taking into account reverse predicates)
    for (const possibleTree of this.schemaMapper.calculatePossibleTrees(tree)) {
      getLogger().debug("Trying possible tree: ", JSON.stringify(possibleTree, null, 2));
      // Check if the schema supports the SPARQL query tree
      const fields = this.schemaMapper.supportsQuery(possibleTree);

      // Try to convert the query and return the first succesfull one
      for (const field of fields) {
        try {
          const responseMapper = new ResponseMapper();
          const query = field.toQuery(possibleTree, responseMapper);
          results.push([ `query { ${query} }`, responseMapper ]);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          console.log(`Error creating query for field ${field.getName()}: ${error.message}`);
        }
      }
    }

    return results;
  }

  public subscribeOperation(operation: Algebra.Operation, type?: SubscriptionType): [string, ResponseMapper][] {
    const results: [string, ResponseMapper][] = [];

    // Convert operation to tree
    const tree = convertOperation(operation);

    // Expand the current tree into all possible trees (taking into account reverse predicates)
    for (const possibleTree of this.schemaMapper.calculatePossibleTrees(tree)) {
      getLogger().debug("Trying possible tree: ", JSON.stringify(possibleTree, null, 2));
      // Check if the schema supports the SPARQL query tree
      const fields = this.schemaMapper.supportsSubscription(possibleTree, type);

      // Try to convert the query and return the first succesfull one
      for (const field of fields) {
        try {
          const responseMapper = new ResponseMapper();
          const query = field.toQuery(possibleTree, responseMapper);
          results.push([ `subscription { ${query} }`, responseMapper ]);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          console.log(`Error creating query for field ${field.getName()}: ${error.message}`);
        }
      }
    }

    return results;
  }
}
