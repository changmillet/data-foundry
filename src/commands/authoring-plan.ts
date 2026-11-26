import { createAuthoringPlanRunner } from "../lib/authoring-plan/runner.ts";
import type { AuthoringPlanDependencies } from "../lib/authoring-plan/types-and-status.ts";

/** Thin command entrypoint delegating dataset-authoring-plan execution to src/lib/authoring-plan. */
export function createAuthoringPlanCommands(dependencies: AuthoringPlanDependencies) {
  return createAuthoringPlanRunner(dependencies);
}
