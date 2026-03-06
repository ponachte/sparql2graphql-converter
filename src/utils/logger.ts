import { ILogger } from "../types";

// Toggle debug via environment variable
const DEBUG = process.env.DEBUG_S2G === "true";

export const defaultLogger: ILogger = {
  debug: (...args: unknown[]) => { if (DEBUG) console.debug("[sparql2graphql]", ...args); },
  info: (...args: unknown[]) => console.info("[sparql2graphql]", ...args),
  warn: (...args: unknown[]) => console.warn("[sparql2graphql]", ...args),
  error: (...args: unknown[]) => console.error("[sparql2graphql]", ...args),
};

export const noopLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

let currentLogger: ILogger = noopLogger;

export function setLogger(logger: ILogger | null) {
  currentLogger = logger ?? defaultLogger;
}

export function getLogger(): ILogger {
  return currentLogger;
}