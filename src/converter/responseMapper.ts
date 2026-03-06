import { RawRDF } from "../types";

export class ResponseMapper {
  private varMap: Record<string, string> = {};
  private filterMap: Record<string, RawRDF> = {};

  public addVarMapping(sparqlVar: string, graphqlVar: string) {
    this.varMap[sparqlVar] = graphqlVar;
  }

  public addFilterMapping(graphqlVar: string, value: RawRDF): void {
    this.filterMap[graphqlVar] = value;
  }
}