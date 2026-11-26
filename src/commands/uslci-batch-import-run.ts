// USLCI batch import runner — delegates to the generic per-scope library batch engine
// with the typed USLCI profile strategy:
//   - profile "uslci" with account-local My Data support override for unmatched FEDEFL
//     elementary flows and unmatched FP/UG support;
//   - BAFU autofill and family-signature ordering disabled;
//   - inline flow support commit and deterministic library-resolution rewrites enabled;
//   - shared NREL / U.S. Federal LCA Commons library contact metadata.
import { createBafuBatchImportRunCommands } from "./bafu-batch-import-run.ts";
import {
  USLCI_BATCH_PROFILE_CONFIG,
  type LibraryBatchImportCommandSet,
  type LibraryBatchImportFactory,
  type LibraryBatchImportFactoryOverrides,
  type LibraryBatchImportRunner,
} from "../lib/batch-orchestration/library-batch-command-runtime.ts";

export type {
  LibraryBatchImportCommandSet,
  LibraryBatchImportFactory,
  LibraryBatchImportFactoryOverrides,
  LibraryBatchImportRunner,
};

export function createUslciBatchImportRunCommands(
  deps: unknown,
  overrides: LibraryBatchImportFactoryOverrides = {},
): { runDatasetUslciBatchImportRun: LibraryBatchImportRunner } {
  const factory: LibraryBatchImportFactory =
    overrides.createBafuBatchImportRunCommands ?? createBafuBatchImportRunCommands;
  const { runDatasetBafuBatchImportRun } = factory(deps, USLCI_BATCH_PROFILE_CONFIG);
  return { runDatasetUslciBatchImportRun: runDatasetBafuBatchImportRun };
}
