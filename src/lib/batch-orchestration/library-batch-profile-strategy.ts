import { stageContract } from "../stage-contract.ts";

export interface JsonRecord {
  [key: string]: unknown;
}

export interface LibraryContactClassification {
  readonly "@level": string;
  readonly "@classId": string;
  readonly "#text": string;
}

export interface LibraryContactConfig extends JsonRecord {
  readonly libraryName: string;
  readonly shortName: string;
  readonly website: string;
  readonly email: string;
  readonly telephone: string;
  readonly contactAddress: string;
  readonly centralContactPoint: string;
  readonly description: string;
  readonly contactClassification?: readonly LibraryContactClassification[];
}

export interface LibraryBatchProfileConfig extends JsonRecord {
  readonly profile?: string;
  readonly commandName?: string;
  readonly enableBafuAutofill?: boolean;
  readonly enableFamilySignatures?: boolean;
  readonly defaults?: JsonRecord;
  readonly commitFlowSupportInline?: boolean;
  readonly mintUnmatchedFpUgSupport?: boolean;
  readonly applyResolutionRewrites?: boolean;
  readonly libraryContact?: LibraryContactConfig;
}

export interface LibraryBatchProfileStrategy {
  readonly profile: string;
  readonly commandName: string;
  readonly enableBafuAutofill: boolean;
  readonly enableFamilySignatures: boolean;
  readonly commitFlowSupportInline: boolean;
  readonly mintUnmatchedFpUgSupport: boolean;
  readonly applyResolutionRewrites: boolean;
  readonly supportIdentityTypes: readonly string[];
  readonly libraryContact: JsonRecord;
  readonly config: LibraryBatchProfileConfig;
}

export type LibraryBatchImportRunner = (options?: Record<string, unknown>) => unknown;

export type LibraryBatchImportCommandSet = {
  runDatasetBafuBatchImportRun: LibraryBatchImportRunner;
};

export type LibraryBatchImportFactory = (
  deps: unknown,
  config: LibraryBatchProfileConfig,
) => LibraryBatchImportCommandSet;

export type LibraryBatchImportFactoryOverrides = {
  createBafuBatchImportRunCommands?: LibraryBatchImportFactory;
};

export const DEFAULT_BATCH_COMMAND_NAME = "dataset-bafu-batch-import-run";
export const DEFAULT_COVERAGE_COMMAND_NAME = "dataset-bafu-universe-coverage-report";

export const LIBRARY_BATCH_STAGE_CONTRACT = {
  remote_write_mode: "explicit-commit-only",
  stage_pipeline: stageContract([
    {
      stage: "load_scope_ledgers",
      phase: "prepare",
      purpose:
        "Load ready scopes plus existing ok/blocked/retry ledgers so reruns skip verified and deferred scopes.",
      inputs: [
        "ready-scopes.jsonl",
        "import-ledger/*.jsonl",
        "optional --ledger-source-dir ledgers",
      ],
      outputs: ["selected process scopes", "run-manifest.json"],
      side_effects: ["writes local Foundry run manifest"],
    },
    {
      stage: "materialize_scope",
      phase: "rewrite_cleanup",
      purpose:
        "Materialize one process scope from process-bundles, apply deterministic rewrites, and refresh exact-payload identity evidence when needed.",
      inputs: ["process-bundles/<process>", "library classification decisions", "context packs"],
      outputs: ["scope materialized rows", "identity preflight artifacts", "patch/apply reports"],
      side_effects: ["writes local scope workspace artifacts"],
    },
    {
      stage: "scope_commit_gate",
      phase: "gate_validate",
      purpose:
        "Run finalize, mutation manifest, handoff planning, remote commit, and readback verify only for scopes whose dependency closure is ready.",
      inputs: ["materialized scope rows", "finalize context", "target user/account guard"],
      outputs: ["commit reports", "remote verification reports", "blocked-scope ledger rows"],
      blockers: [
        "unresolved AI/human review dependencies",
        "reference closure failures",
        "remote write failures",
      ],
      side_effects: ["may write verified rows to the remote database when --commit is supplied"],
    },
    {
      stage: "ledger_report",
      phase: "report",
      purpose:
        "Write separated ok, blocked, and retry ledgers plus a reader-facing batch report for resumable import.",
      inputs: ["scope run results"],
      outputs: [
        "dataset-bafu-batch-import-run-report.json",
        "scope-checkpoints.jsonl",
        "import-ledger/ok.*.jsonl",
        "import-ledger/blocked.*.jsonl",
        "import-ledger/failed.scopes.retry.jsonl",
      ],
      side_effects: ["writes local Foundry ledgers"],
    },
  ]).map((stage) => ({
    ...stage,
    report_contract: {
      ...stage.report_contract,
      remote_write_mode: "explicit-commit-only",
    },
  })),
};

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function resolveLibraryBatchProfileStrategy(
  config: LibraryBatchProfileConfig = {},
): LibraryBatchProfileStrategy {
  const safeConfig = config || {};
  const mintUnmatchedFpUgSupport = Boolean(safeConfig.mintUnmatchedFpUgSupport);
  return {
    profile: safeConfig.profile || "bafu",
    commandName: safeConfig.commandName || DEFAULT_BATCH_COMMAND_NAME,
    enableBafuAutofill: safeConfig.enableBafuAutofill !== false,
    enableFamilySignatures: safeConfig.enableFamilySignatures !== false,
    commitFlowSupportInline: Boolean(safeConfig.commitFlowSupportInline),
    mintUnmatchedFpUgSupport,
    applyResolutionRewrites: Boolean(safeConfig.applyResolutionRewrites),
    supportIdentityTypes: mintUnmatchedFpUgSupport
      ? ["contact", "source", "unitgroup", "flowproperty"]
      : ["contact", "source"],
    libraryContact: isJsonRecord(safeConfig.libraryContact) ? safeConfig.libraryContact : {},
    config: safeConfig,
  };
}

export const BAFU_BATCH_PROFILE_CONFIG: LibraryBatchProfileConfig = Object.freeze({
  profile: "bafu",
  commandName: DEFAULT_BATCH_COMMAND_NAME,
  enableBafuAutofill: true,
  enableFamilySignatures: true,
  commitFlowSupportInline: false,
  mintUnmatchedFpUgSupport: false,
  applyResolutionRewrites: false,
});

export const USLCI_BATCH_PROFILE_CONFIG: LibraryBatchProfileConfig = Object.freeze({
  profile: "uslci",
  commandName: "dataset-uslci-batch-import-run",
  enableBafuAutofill: false,
  enableFamilySignatures: false,
  commitFlowSupportInline: true,
  mintUnmatchedFpUgSupport: true,
  applyResolutionRewrites: true,
  libraryContact: Object.freeze({
    libraryName: "National Renewable Energy Laboratory (NREL)",
    shortName: "NREL",
    website: "https://www.lcacommons.gov",
    email: "lci@nrel.gov",
    telephone: "+1 303-275-3000",
    contactAddress:
      "National Renewable Energy Laboratory, 15013 Denver West Parkway, Golden, CO 80401, USA",
    centralContactPoint: "U.S. Federal LCA Commons (https://www.lcacommons.gov); lci@nrel.gov",
    description:
      "Library-level contact for the USLCI Database Public package, published by the National Renewable Energy Laboratory (NREL) on the U.S. Federal LCA Commons.",
  }),
});

export const WORLDSTEEL_BATCH_PROFILE_CONFIG: LibraryBatchProfileConfig = Object.freeze({
  profile: "worldsteel",
  commandName: "dataset-worldsteel-batch-import-run",
  enableBafuAutofill: false,
  enableFamilySignatures: false,
  commitFlowSupportInline: true,
  mintUnmatchedFpUgSupport: true,
  applyResolutionRewrites: true,
  libraryContact: Object.freeze({
    libraryName: "World Steel Association",
    shortName: "worldsteel",
    website: "https://www.worldsteel.org",
    email: "steel@worldsteel.org",
    contactClassification: Object.freeze([
      Object.freeze({ "@level": "0", "@classId": "2", "#text": "Organisations" }),
      Object.freeze({ "@level": "1", "@classId": "2.4", "#text": "Other organisations" }),
    ]),
    contactAddress: "worldsteel, Avenue de Tervueren 270, 1150 Brussels, Belgium",
    telephone: "+32 (0) 2 702 8900",
    centralContactPoint:
      "worldsteel, Avenue de Tervueren 270, 1150 Brussels, Belgium; steel@worldsteel.org; +32 (0) 2 702 8900",
    description:
      "Library-level contact for the worldsteel EF3.1 LCI data package, the World Steel Association (worldsteel) — a non-profit international steel industry association.",
  }),
});

export const BAFU_BATCH_PROFILE_STRATEGY =
  resolveLibraryBatchProfileStrategy(BAFU_BATCH_PROFILE_CONFIG);
export const USLCI_BATCH_PROFILE_STRATEGY = resolveLibraryBatchProfileStrategy(
  USLCI_BATCH_PROFILE_CONFIG,
);
export const WORLDSTEEL_BATCH_PROFILE_STRATEGY = resolveLibraryBatchProfileStrategy(
  WORLDSTEEL_BATCH_PROFILE_CONFIG,
);

export const LIBRARY_BATCH_PROFILE_STRATEGIES = Object.freeze({
  bafu: BAFU_BATCH_PROFILE_STRATEGY,
  uslci: USLCI_BATCH_PROFILE_STRATEGY,
  worldsteel: WORLDSTEEL_BATCH_PROFILE_STRATEGY,
});
