// worldsteel batch import runner — delegates to the generic per-scope library batch engine
// with the typed worldsteel profile strategy:
//   - profile "worldsteel" reusing canonical EF3.1 reference flows via offline
//     library-resolution rewrites while allowing capped account-local minting for
//     unmatched pseudo-elementary flows and unmatched EF3.1 LANCA FP/UG support;
//   - BAFU autofill and family-signature ordering disabled;
//   - inline flow support commit enabled with World Steel Association contact metadata.
import { createBafuBatchImportRunCommands } from "./bafu-batch-import-run.ts";
import {
  WORLDSTEEL_BATCH_PROFILE_CONFIG,
  type LibraryBatchImportCommandSet,
  type LibraryBatchImportFactory,
  type LibraryBatchImportFactoryOverrides,
  type LibraryBatchImportRunner,
} from "../lib/batch-orchestration/library-batch-command-runtime.ts";

export type WorldsteelBatchImportRunner = LibraryBatchImportRunner;
export type WorldsteelBatchImportCommandSet = LibraryBatchImportCommandSet;
export type WorldsteelBatchImportFactory = LibraryBatchImportFactory;
export type WorldsteelBatchImportFactoryOverrides = LibraryBatchImportFactoryOverrides;

export function createWorldsteelBatchImportRunCommands(
  deps: unknown,
  overrides: WorldsteelBatchImportFactoryOverrides = {},
): { runDatasetWorldsteelBatchImportRun: WorldsteelBatchImportRunner } {
  const factory: WorldsteelBatchImportFactory =
    overrides.createBafuBatchImportRunCommands ?? createBafuBatchImportRunCommands;
  const { runDatasetBafuBatchImportRun } = factory(deps, WORLDSTEEL_BATCH_PROFILE_CONFIG);
  return { runDatasetWorldsteelBatchImportRun: runDatasetBafuBatchImportRun };
}
