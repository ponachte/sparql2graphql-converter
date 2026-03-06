const fs = require("fs");
const readline = require("readline");
const { QueryMapper, setLogger } = require("./dist/index.js");
const { DataFactory } = require("rdf-data-factory");
const { BindingsFactory } = require("@comunica/utils-bindings-factory");

const dataFactory = new DataFactory();
const bindingsFactory = new BindingsFactory(dataFactory);

const variables = [
  //dataFactory.variable("patient"),
  dataFactory.variable("obs"),
  dataFactory.variable("value"),
  dataFactory.variable("unit"),
  dataFactory.variable("timestamp"),
];

const QUERY = `
PREFIX ex: <http://example.org/>
SELECT ?value ?unit ?timestamp 
WHERE {
  ?obs a ex:Observation ;
    ex:value ?value ;
    ex:unit ?unit ;
    ex:timestamp ?timestamp .
}
`;

const CONTEXT = {
  kss: "https://kvasir.discover.ilabt.imec.be/vocab#",
  schema: "http://schema.org/",
  ex: "http://example.org/"
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
  atTime: DateTime! @predicate(iri: "ex:timestamp")
  forPatient: ID! @predicate(iri: "ex:hasObservation", reverse: true)
}`;

setLogger();

const queryMapper = new QueryMapper(SCHEMA, CONTEXT);

// Convert query
const [query, responseMapper] = queryMapper.query(QUERY);

console.log("Generated query:\n");
console.log(query);

// Wait for user ENTER
function waitForEnter() {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question("\nPress ENTER once resp.json is ready...", () => {
      rl.close();
      resolve();
    });
  });
}

(async () => {
  await waitForEnter();

  // Read response
  const raw = fs.readFileSync("./resp.json", "utf8");
  const data = JSON.parse(raw);

  // Convert to bindings
  const bindings = responseMapper.dataToBindings(
    data,
    variables,
    dataFactory,
    bindingsFactory
  );

  console.log("\nBindings:\n");

  for (const b of bindings) {
    const obj = {};
    for (const [v, term] of b) {
      obj[v.value] = term.value;
    }
    console.log(obj);
  }
})();