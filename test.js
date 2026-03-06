const { QueryMapper, setLogger } = require("./dist/index.js");

const QUERY = `
PREFIX ex: <http://example.org/>
SELECT ?patient ?value ?unit ?timestamp 
WHERE {
  ?patient ex:hasObservation ?obs .
  ?obs a ex:Observation ;
    ex:value ?value ;
    ex:unit ?unit ;
    ex:timestamp ?timestamp .
}
`;

const CONTEXT = {
  "kss": "https://kvasir.discover.ilabt.imec.be/vocab#",
  "schema": "http://schema.org/",
  "ex": "http://example.org/"
};

const SCHEMA = `
type Query {
  observations: [Observation]!
  observation(id: ID!): Observation
}

type Subscription {
  observationAdded: Observation!
}

type Observation @class(iri: "ex:Observation") {
  id: ID!
  value: Int! @predicate(iri: "ex:value")
  ex_unit: String!
  timestamp: DateTime! @predicate(iri: "ex:timestamp")
  forPatient: ID! @predicate(iri: "ex:hasObservation", reverse: true)
}`;

setLogger();

const queryMapper = new QueryMapper(SCHEMA, CONTEXT);

// Convert query
const [ query, responseMapper ] = queryMapper.subscribe(QUERY);

console.log(query);