export const supportedLibraryBatchProfiles = ["bafu", "uslci", "worldsteel"] as const;

export type SupportedLibraryBatchProfile = (typeof supportedLibraryBatchProfiles)[number];

type JsonRecord = Record<string, unknown>;
type ProfileRunner = (options?: JsonRecord) => unknown;

export interface LibraryBatchImportCommandDeps {
  bafuBatchImportRunCommands: {
    runDatasetBafuBatchImportRun: ProfileRunner;
  };
  uslciBatchImportRunCommands: {
    runDatasetUslciBatchImportRun: ProfileRunner;
  };
  worldsteelBatchImportRunCommands: {
    runDatasetWorldsteelBatchImportRun: ProfileRunner;
  };
}

function normalizeProfile(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().toLowerCase();
}

export function createLibraryBatchImportCommands(deps: LibraryBatchImportCommandDeps) {
  const runners: Record<SupportedLibraryBatchProfile, ProfileRunner> = {
    bafu: deps.bafuBatchImportRunCommands.runDatasetBafuBatchImportRun,
    uslci: deps.uslciBatchImportRunCommands.runDatasetUslciBatchImportRun,
    worldsteel: deps.worldsteelBatchImportRunCommands.runDatasetWorldsteelBatchImportRun,
  };

  async function runLibraryBatchImport(options: JsonRecord = {}): Promise<unknown> {
    const rawProfile =
      typeof options.profile === "string" || typeof options.profile === "number"
        ? String(options.profile).trim()
        : "";
    const normalizedProfile = normalizeProfile(options.profile);

    if ((options.help || options.h) && !rawProfile) {
      return {
        schema_version: 1,
        status: "help",
        command: "library-batch-import",
        supported_profiles: [...supportedLibraryBatchProfiles],
        usage: [
          "node src/dev-cli.ts library-batch-import --profile <bafu|uslci|worldsteel> --scope-file <ready-scopes.jsonl> --process-bundles-dir <.../process-bundles> --run-dir <run-dir> --preflight-only",
          "node src/dev-cli.ts library-batch-import --profile <bafu|uslci|worldsteel> --scope-file <ready-scopes.jsonl> --out-dir <batch-dir> --pending-only --target-user-id <uuid> --commit",
          "node src/dev-cli.ts library-batch-import --profile <bafu|uslci|worldsteel> --help",
        ],
        purpose:
          "Unified offline/batch planner and resumable scope import runner across supported external library profiles (bafu, uslci, worldsteel).",
        remote_write_mode: "opt-in-commit",
      };
    }

    if (!rawProfile) {
      return {
        schema_version: 1,
        status: "blocked",
        command: "library-batch-import",
        profile: null,
        supported_profiles: [...supportedLibraryBatchProfiles],
        blockers: [
          {
            code: "missing_library_batch_profile",
            message: "library-batch-import requires --profile <bafu|uslci|worldsteel>.",
          },
        ],
      };
    }

    if (!Object.hasOwn(runners, normalizedProfile)) {
      return {
        schema_version: 1,
        status: "blocked",
        command: "library-batch-import",
        profile: rawProfile,
        supported_profiles: [...supportedLibraryBatchProfiles],
        blockers: [
          {
            code: "unsupported_library_batch_profile",
            message: `Unsupported library-batch-import profile '${rawProfile}'. Expected one of: ${supportedLibraryBatchProfiles.join(", ")}.`,
          },
        ],
      };
    }

    const runner = runners[normalizedProfile as SupportedLibraryBatchProfile];
    return runner({ ...options, profile: normalizedProfile });
  }

  return { runLibraryBatchImport };
}
