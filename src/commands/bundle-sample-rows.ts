import { createBundleSampleRowsRunner } from "../lib/bundle-sample-rows/runner.ts";
import type { BundleSampleDependencies } from "../lib/bundle-sample-rows/types.ts";

/** Thin command entrypoint delegating dataset-bundle-sample-rows to src/lib/bundle-sample-rows. */
export function createBundleSampleRowsCommands(dependencies: BundleSampleDependencies) {
  return createBundleSampleRowsRunner(dependencies);
}
