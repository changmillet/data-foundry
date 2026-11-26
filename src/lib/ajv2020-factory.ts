import Ajv2020Import from "ajv/dist/2020.js";
import type { Ajv2020 as Ajv2020Instance, Options } from "ajv/dist/2020.js";

type Ajv2020Ctor = new (options?: Options) => Ajv2020Instance;
type Ajv2020Candidate = Ajv2020Ctor | { readonly default: Ajv2020Ctor };

function resolveAjv2020Constructor(candidate: Ajv2020Candidate): Ajv2020Ctor {
  return typeof candidate === "function" ? candidate : candidate.default;
}

export function createAjv2020(options?: Options): Ajv2020Instance {
  const Constructor = resolveAjv2020Constructor(Ajv2020Import);
  return new Constructor(options);
}
