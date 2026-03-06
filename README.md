# SPARQL to GraphQL Query Mapper

[![npm](https://img.shields.io/npm/v/@comunica-graphql/sparql2graphql-converter.svg)](https://www.npmjs.com/package/@comunica-graphql/sparql2graphql-converter)

A library that converts **SPARQL queries into GraphQL queries** using a GraphQL schema annotated with RDF metadata, and converts the **GraphQL response back into RDF bindings**.

This allows you to query RDF data through a **GraphQL API** while still working with **SPARQL-style queries and RDF terms** in your application.

The package performs two main tasks:

1. **Query Mapping**
   Converts a SPARQL `SELECT` query into a GraphQL query based on a schema.

2. **Response Mapping**
   Converts the resulting **GraphQL JSON response** back into RDF **bindings** compatible with RDFJS tools.

# Features

* Convert **SPARQL → GraphQL**
* Convert **GraphQL responses → RDFJS bindings**
* Supports **custom RDF predicates via schema annotations**
* Supports **reverse predicates via schema annotations**

# Installation

```bash
npm install sparql2graphql-converter
```

# Concept Overview

The mapper uses a **GraphQL schema annotated with RDF metadata**.

Example:

```graphql
type Observation @class(iri: "ex:Observation") {
  id: ID!
  value: Int! @predicate(iri: "ex:value")
  ex_unit: String!
  atTime: DateTime! @predicate(iri: "ex:timestamp")
  forSensor: ID! @predicate(iri: "ex:hasObservation", reverse: true)
}
```

Annotations define how GraphQL fields map to RDF:

| Annotation      | Purpose                         |
| --------------- | ------------------------------- |
| `@class`        | maps GraphQL type → RDF class   |
| `@predicate`    | maps field → RDF predicate      |
| `reverse: true` | indicates reversed RDF relation |

# Basic Usage

## 1. Import the Library

```js
const { QueryMapper } = require("sparql2graphql-converter");
```

## 2. Define RDF Context

The context maps prefixes to namespaces.

```js
const CONTEXT = {
  ex: "http://example.org/",
};
```

## 3. Define GraphQL Schema

The schema describes how RDF concepts map to GraphQL.

```graphql
type Query {
  observations: [Observation]!
  observation(id: ID!): Observation
}

type Observation @class(iri: "ex:Observation") {
  id: ID!
  value: Int! @predicate(iri: "ex:value")
  ex_unit: String!
  atTime: DateTime! @predicate(iri: "ex:timestamp")
}
```

## 4. Create QueryMapper

```js
const queryMapper = new QueryMapper(SCHEMA, CONTEXT);
```

## 5. Convert a SPARQL Query

Example SPARQL query:

```sparql
PREFIX ex: <http://example.org/>

SELECT ?value ?unit ?timestamp 
WHERE {
  ?obs a ex:Observation ;
       ex:value ?value ;
       ex:unit ?unit ;
       ex:timestamp ?timestamp .
}
```

Convert it:

```js
const [query, responseMapper] = queryMapper.query(QUERY);

console.log(query);
```

Example generated GraphQL query:

```graphql
query {
  observations {
    value
    ex_unit
    atTime
  }
}
```

The mapper also returns a **ResponseMapper** which must be used later to convert the response.

# Handling the GraphQL Response

The GraphQL API returns a standard JSON response.

Example:

```json
{
  "data": {
    "observations": [
      {
        "value": 120,
        "ex_unit": "mmHg",
        "atTime": "2024-01-01T10:00:00Z"
      }
    ]
  }
}
```

## Convert Response to RDF Bindings

Example:

```js
const { DataFactory } = require("rdf-data-factory");
const { BindingsFactory } = require("@comunica/utils-bindings-factory");

const dataFactory = new DataFactory();
const bindingsFactory = new BindingsFactory(dataFactory);

const variables = [
  dataFactory.variable("value"),
  dataFactory.variable("unit"),
  dataFactory.variable("timestamp"),
];

const bindings = responseMapper.dataToBindings(
  graphqlResponse,
  variables,
  dataFactory,
  bindingsFactory
);
```

The result is a list of **RDFJS bindings**.

Example output:

```js
{
  value: "120",
  unit: "mmHg",
  timestamp: "2024-01-01T10:00:00Z"
}
```

# Full Example

```js
const { QueryMapper } = require("sparql2graphql-converter");
const { DataFactory } = require("rdf-data-factory");
const { BindingsFactory } = require("@comunica/utils-bindings-factory");

const dataFactory = new DataFactory();
const bindingsFactory = new BindingsFactory(dataFactory);

const mapper = new QueryMapper(SCHEMA, CONTEXT);

const [query, responseMapper] = mapper.query(SPARQL_QUERY);

// Send query to GraphQL API
const response = await fetchGraphQL(query);

// Convert response
const bindings = responseMapper.dataToBindings(
  response,
  variables,
  dataFactory,
  bindingsFactory
);
```

# Custom Logger

You can provide a custom logger implementation.

Interface:

```ts
export interface ILogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
```

Example:

```js
const { setLogger } = require("sparql2graphql-converter");

setLogger({
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error
});
```

Or simply enable the default logger:

```js
setLogger();
```

# Use Cases

Typical scenarios:

* Querying **RDF data through a GraphQL API**
* Integrating **SPARQL engines with GraphQL services**

# License

MIT
