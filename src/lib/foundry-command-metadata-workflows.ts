import type {
  CommandMetadataBuilders,
  FoundryInternalStageMetadata,
} from "./foundry-command-metadata-core.ts";

export function buildWorkflowInternalStageMetadata(
  builders: CommandMetadataBuilders,
): Record<string, FoundryInternalStageMetadata> {
  const {
    metadata,
    goldenDiff,
    nodeTest,
    importCurationEntryContract,
    postAuthoringFinalizeCommandContract,
    typedImportOwner,
    owners,
    tests,
  } = builders;

  return {
    "dataset-library-index-build": metadata({
      category: "workflow-internal",
      ownerModule: owners.libraryScopeWorkflow,
      ownerExport: "createLibraryScopeWorkflowCommands().runDatasetLibraryIndexBuild",
      inputs: ["root TIDAS library directory", "process-bundles/index.json"],
      outputs: [
        "library-entity-index.jsonl",
        "scope-projection.jsonl",
        "dataset-library-index-build-report.json",
      ],
      keyTests: [
        nodeTest(
          "test/scenarios/library-scope-workflow.test.mts",
          "library index deduplicates root TIDAS entities and projects shared dependencies to process scopes",
        ),
      ],
    }),
    "dataset-library-authoring-plan": metadata({
      category: "workflow-internal",
      ownerModule: owners.libraryScopeWorkflow,
      ownerExport: "createLibraryScopeWorkflowCommands().runDatasetLibraryAuthoringPlan",
      inputs: ["library-entity-index.jsonl", "scope-projection.jsonl"],
      outputs: [
        "identity-decisions.template.jsonl",
        "classification-decisions.template.jsonl",
        "canonical-support-mappings.template.jsonl",
      ],
      keyTests: [
        nodeTest(
          "test/scenarios/library-scope-workflow.test.mts",
          "library authoring plan emits deduplicated semantic decision templates",
        ),
      ],
    }),
    "dataset-library-identity-decisions-from-preflight": metadata({
      category: "workflow-internal",
      ownerModule: owners.libraryScopeWorkflow,
      ownerExport:
        "createLibraryScopeWorkflowCommands().runDatasetLibraryIdentityDecisionsFromPreflight",
      inputs: ["library index", "elementary flow identity-preflight request index and reports"],
      outputs: [
        "identity-decisions.jsonl",
        "identity-decisions.manual-review.jsonl",
        "dataset-library-identity-decisions-from-preflight-report.json",
      ],
      keyTests: [
        nodeTest(
          "test/scenarios/library-scope-workflow.test.mts",
          "library identity decisions from preflight emits reuse decisions and manual review rows",
        ),
        nodeTest(
          tests.libraryScopeWorkflowElementaryIdentity,
          "elementary identity evaluation preserves source/openLCA compartments and conservative candidate matching",
        ),
      ],
    }),
    "dataset-library-decisions-apply": metadata({
      category: "workflow-internal",
      ownerModule: owners.libraryScopeWorkflow,
      ownerExport: "createLibraryScopeWorkflowCommands().runDatasetLibraryDecisionsApply",
      inputs: [
        "library index",
        "identity decisions",
        "classification decisions",
        "canonical support mappings",
      ],
      outputs: [
        "library-resolution.json",
        "scope-checkpoints.jsonl",
        "blocked-scope-ledger.jsonl",
        "blocked-scope-report.json",
        "exchange-reference-rewrites.jsonl",
      ],
      keyTests: [
        nodeTest(
          "test/scenarios/library-scope-workflow.test.mts",
          "library decisions apply rewrites only elementary flow references and defers unresolved scopes",
        ),
      ],
    }),
    "dataset-process-scope-run": metadata({
      category: "workflow-internal",
      ownerModule: owners.libraryScopeWorkflow,
      ownerExport: "createLibraryScopeWorkflowCommands().runDatasetProcessScopeRun",
      inputs: ["process-bundles directory", "library-resolution.json", "scope file"],
      outputs: [
        "scope-checkpoints.jsonl",
        "blocked-scope-ledger.jsonl",
        "blocked-scope-report.json",
        "dataset-process-scope-run-report.json",
      ],
      keyTests: [
        nodeTest(
          "test/scenarios/library-scope-workflow.test.mts",
          "process scope runner plans only ready scopes and keeps blocked scopes out of the queue",
        ),
      ],
    }),
    "dataset-bafu-process-scope-e2e": metadata({
      category: "workflow-internal",
      ownerModule: owners.bafuProcessScopeE2e,
      ownerExport: "createBafuProcessScopeE2eCommands().runDatasetBafuProcessScopeE2e",
      inputs: [
        "one process rows file",
        "optional source support rows file",
        "optional source rows file",
        "post-authoring finalize context options",
        "optional verified support identity cache",
      ],
      outputs: [
        "bafu-process-scope-e2e-report.json",
        "bafu-process-scope-e2e-ledger.jsonl",
        "dataset-post-authoring-finalize-report.json when executed or resumed",
        "reused-support-identities.json when support handoff is skipped from verified cache",
      ],
      keyTests: [
        nodeTest(
          tests.bafuProcessScopeE2e,
          "BAFU process scope helper hard-blocks unresolved AI curation items on resume",
        ),
      ],
    }),
    "dataset-bafu-batch-import-run": metadata({
      category: "workflow-internal",
      ownerModule: owners.bafuBatchImportRun,
      ownerExport: "createBafuBatchImportRunCommands().runDatasetBafuBatchImportRun",
      inputs: [
        "ready-scopes.jsonl",
        "process-bundles directory",
        "BAFU run directory with context and library decisions",
        "target user id",
        "optional prior batch/import-ledger directories for pending-only carry-forward",
        "optional explicit retry ids via repeated --process-id or --process-id-file (one id per line, # comments and blank lines ignored)",
      ],
      outputs: [
        "dataset-bafu-batch-import-run-report.json",
        "scope-checkpoints.jsonl",
        "import-ledger/ok.*.verified.jsonl",
        "import-ledger/blocked.*.jsonl",
        "import-ledger/failed.scopes.retry.jsonl",
        "import-ledger/verified-support-identities.jsonl",
        "import-ledger/preflight.plan.jsonl when --preflight-only is used",
      ],
      keyTests: [
        nodeTest(
          tests.bafuBatchImportRun,
          "BAFU batch import runner skips already verified scopes through resumable ledgers",
        ),
        nodeTest(
          tests.bafuBatchImportRun,
          "BAFU batch import runner applies pending-only before limit and honors pause file",
        ),
        nodeTest(
          tests.bafuBatchImportRun,
          "BAFU batch import runner carries forward prior ledgers into fresh batch selection",
        ),
        nodeTest(
          tests.bafuBatchImportRun,
          "BAFU batch import runner writes read-only preflight plan and primes support identity cache",
        ),
      ],
    }),
    "dataset-uslci-batch-import-run": metadata({
      category: "workflow-internal",
      ownerModule: owners.uslciBatchImportRun,
      ownerExport: "createUslciBatchImportRunCommands().runDatasetUslciBatchImportRun",
      inputs: [
        "ready-scopes.jsonl (library-resolution-v8)",
        "process-bundles directory (conversion-v6)",
        "USLCI run directory with context and pre-authored decisions-v4",
        "library classification decisions (decisions-v4/classification-decisions.jsonl)",
        "target user id (USLCI account)",
        "optional prior batch/import-ledger directories for pending-only carry-forward",
        "optional explicit retry ids via repeated --process-id or --process-id-file",
      ],
      outputs: [
        "dataset-uslci-batch-import-run-report.json",
        "scope-checkpoints.jsonl",
        "import-ledger/ok.*.verified.jsonl",
        "import-ledger/blocked.*.jsonl",
        "import-ledger/failed.scopes.retry.jsonl",
        "import-ledger/verified-support-identities.jsonl",
        "import-ledger/preflight.plan.jsonl when --preflight-only is used",
      ],
      keyTests: [
        nodeTest(
          tests.bafuBatchImportRun,
          "BAFU batch import runner skips already verified scopes through resumable ledgers",
        ),
      ],
    }),
    "dataset-worldsteel-batch-import-run": metadata({
      category: "workflow-internal",
      ownerModule: owners.worldsteelBatchImportRun,
      ownerExport: "createWorldsteelBatchImportRunCommands().runDatasetWorldsteelBatchImportRun",
      inputs: [
        "ready-scopes.jsonl (worldsteel library-resolution)",
        "process-bundles directory (worldsteel conversion)",
        "worldsteel run directory with context and pre-authored decisions",
        "library classification decisions (decisions/classification-decisions.jsonl)",
        "library-resolution directory holding exchange-reference-rewrites.jsonl (UUID reuse)",
        "target user id (worldsteel account: data@worldsteel.org)",
        "optional prior batch/import-ledger directories for pending-only carry-forward",
        "optional explicit retry ids via repeated --process-id or --process-id-file",
      ],
      outputs: [
        "dataset-worldsteel-batch-import-run-report.json",
        "scope-checkpoints.jsonl",
        "import-ledger/ok.*.verified.jsonl",
        "import-ledger/blocked.*.jsonl",
        "import-ledger/failed.scopes.retry.jsonl",
        "import-ledger/verified-support-identities.jsonl",
        "import-ledger/preflight.plan.jsonl when --preflight-only is used",
      ],
      keyTests: [
        nodeTest(
          tests.bafuBatchImportRun,
          "BAFU batch import runner skips already verified scopes through resumable ledgers",
        ),
      ],
    }),
    "dataset-bafu-universe-coverage-report": metadata({
      category: "workflow-internal",
      ownerModule: owners.bafuBatchImportRun,
      ownerExport: "createBafuBatchImportRunCommands().runDatasetBafuUniverseCoverageReport",
      inputs: [
        "BAFU input directory",
        "process-bundles/index.json",
        "ready-scopes.jsonl files",
        "explicit prior batch/import-ledger directories",
      ],
      outputs: [
        "bafu-universe-coverage-report.json",
        "bafu-process-universe.coverage.jsonl",
        "bafu-process-coverage-gaps.jsonl",
        "bafu-flow-reference-coverage.jsonl",
        "bafu-flow-reference-coverage-gaps.jsonl",
      ],
      keyTests: [
        nodeTest(
          tests.bafuBatchImportRun,
          "BAFU universe coverage report compares full process universe with ready scopes and ledgers",
        ),
      ],
    }),
    "dataset-identity-reference-rewrites-apply": metadata({
      category: "workflow-internal",
      ownerModule: owners.identityReferenceRewrites,
      ownerExport:
        "createIdentityReferenceRewriteCommands().runDatasetIdentityReferenceRewritesApply",
      inputs: ["process rows file", "identity-preflight index or identity decision rewrites"],
      outputs: [
        "rewritten rows file",
        "identity-reference-rewrites-apply-report.json",
        "reference reuse rows",
      ],
      keyTests: [
        nodeTest(
          "test/scenarios/flow-identity-decisions.test.mts",
          "identity duplicate flow rewrites require high-confidence preflight evidence",
        ),
      ],
    }),
    "dataset-identity-decisions-apply": metadata({
      category: "workflow-internal",
      ownerModule: owners.identityDecisions,
      ownerExport: "createIdentityDecisionCommands().runDatasetIdentityDecisionsApply",
      inputs: ["rows file", "AI identity decisions", "identity decision task proof"],
      outputs: [
        "identity-decisions-apply-report.json",
        "write candidate rows",
        "reference reuse rows",
        "reference rewrites",
      ],
      keyTests: [
        nodeTest(
          tests.authoringPlan,
          "dataset-identity-decisions-apply filters mixed decisions by requested type",
        ),
        nodeTest(
          "test/scenarios/flow-identity-decisions.test.mts",
          "AI identity decisions apply split flow rows into writes and reference reuse",
        ),
      ],
    }),
    "dataset-post-authoring-finalize": metadata({
      category: "workflow-internal",
      ownerModule: owners.postAuthoringFinalize,
      ownerExport: "createPostAuthoringFinalizeCommands().runDatasetPostAuthoringFinalize",
      inputs: [
        "patched or decision-applied rows",
        "profile",
        "queue artifacts",
        "schema/context files",
        "decision/patch evidence",
        "optional explicit Process QA reference rows and verified reference intent",
        "optional task-indexed preparation quality review, rechecked against final rows and QA",
      ],
      outputs: [
        "post-authoring-finalize report (always)",
        "cleanup report (always after cleanup attempt)",
        "cleanup-complete: final rows file",
        "cleanup-complete: schema and dry-run reports",
        "cleanup-blocked: ordered blockers, blocked import ledger, null final rows, no CommandSpec",
        "cleanup-blocked: every pre-existing stale artifact is preserved and reported",
      ],
      keyTests: [
        nodeTest(
          "test/scenarios/finalize-reference-inputs.test.mts",
          "explicit reference selections fail before finalizer outputs or owner CLI calls",
        ),
        goldenDiff,
        postAuthoringFinalizeCommandContract,
        nodeTest(
          "test/unit/foundry-stage-contract.test.mts",
          "complex workflow commands publish AI-readable stage contracts",
        ),
        nodeTest(
          "test/scenarios/post-authoring-finalize-gates.test.mts",
          "post-authoring finalize declares external process flow refs for remote proof",
        ),
        nodeTest(
          "test/scenarios/post-authoring-finalize-gates.test.mts",
          "post-authoring finalize auto-builds curation queue context from sibling process bundle rows",
        ),
        nodeTest(
          "test/scenarios/post-authoring-finalize-gates.test.mts",
          "post-authoring finalize stops after invalid datetime cleanup without downstream evidence",
        ),
      ],
    }),
    "dataset-commit-handoff-plan": metadata({
      category: "workflow-internal",
      ownerModule: owners.commitHandoff,
      ownerExport: "createCommitHandoffCommands().runDatasetCommitHandoffPlan",
      inputs: [
        "mutation manifest",
        "finalize report",
        "location audit evidence",
        "current task authorization for restricted final rows or QA exceptions",
        "optional explicit native draft execution-contract file (insert or save_draft) for Flow, Process or Source",
      ],
      outputs: [
        "commit handoff plan JSON report",
        "authoritative commit and post-write verify CommandSpecs with executable, argv, display, binding, and SHA-256",
        "final rows artifact facts with exact path, bytes, and SHA-256",
        "conditional native execution-contract raw artifact and normalized owner report binding",
        "conditional reference intent, precommit and review artifact bindings",
      ],
      keyTests: [
        nodeTest(
          "test/scenarios/handoff-reference-intent.test.mts",
          "handoff automatically retains the passing reference intent and all evidence in both command specs",
        ),
        nodeTest(
          "test/scenarios/native-insert-closeout.test.mts",
          "native closeout rejects a completed report from a different contract despite exact root readback",
        ),
        nodeTest(
          "test/unit/handoff-identity-task-command-factories.test.mts",
          "explicit native draft handoff binds a save_draft update and preserves the exact CLI action projection",
        ),
        nodeTest(
          "test/scenarios/foundry-public-native-draft.test.mts",
          "public native draft repair accepts a bound save_draft contract without extra dispatch",
        ),
        nodeTest(
          "test/unit/handoff-identity-task-command-factories.test.mts",
          "mixed support handoff rechecks exact task actions against actual final rows",
        ),
        nodeTest(
          "test/unit/foundry-command-spec.test.mts",
          "CommandSpec blocks artifact byte drift before spawn and never executes display",
        ),
        nodeTest(
          "test/scenarios/full-context-completion-closeout.test.mts",
          "commit handoff blocks nonzero location audit blockers",
        ),
        nodeTest(
          "test/scenarios/full-context-completion-closeout.test.mts",
          "process commit handoff defaults draft state code and records account guard",
        ),
      ],
    }),
    "dataset-post-write-closeout": metadata({
      category: "workflow-internal",
      ownerModule: owners.postWriteCloseout,
      ownerExport: "createPostWriteCloseoutCommands().runDatasetPostWriteCloseout",
      inputs: [
        "final rows",
        "write result",
        "trace queues",
        "readback/verify evidence",
        "native handoff contract binding when selected",
      ],
      outputs: ["post-write-closeout-report.json"],
      keyTests: [
        nodeTest(
          "test/scenarios/native-insert-closeout.test.mts",
          "native closeout accepts exact consumed insert/readback evidence and still requires unique roots",
        ),
        nodeTest(
          "test/unit/handoff-identity-task-command-factories.test.mts",
          "native draft closeout rejects forged, incomplete or wrong-operation recovered rows",
        ),
        nodeTest(
          "test/scenarios/full-context-completion-closeout.test.mts",
          "post-write closeout requires common:other trace queues to match final rows",
        ),
      ],
    }),
    "dataset-import-completion-report": metadata({
      category: "workflow-internal",
      ownerModule: owners.importCompletion,
      ownerExport: "createImportCompletionCommands().runDatasetImportCompletionReport",
      inputs: ["task manifest", "post-write closeout reports", "mutation manifests"],
      outputs: ["dataset-import-completion-report.json"],
      keyTests: [
        nodeTest(
          "test/scenarios/full-context-completion-closeout.test.mts",
          "full-context import completion gates block missing proof and pass evidenced BAFU scopes",
        ),
      ],
    }),
    "dataset-import-ledger-report": metadata({
      category: "workflow-internal",
      ownerModule: owners.importLedger,
      ownerExport: "createImportLedgerCommands().runDatasetImportLedgerReport",
      inputs: ["task import ledger directory with ok/blocked/retry JSONL files"],
      outputs: [
        "dataset-import-ledger-report.json",
        "resume.plan.jsonl",
        "resume.skipped-verified.jsonl",
      ],
      keyTests: [
        nodeTest(
          tests.importLedger,
          "import ledger report separates verified rows from human-review resume scopes",
        ),
      ],
    }),
    "dataset-mutation-manifest": metadata({
      category: "workflow-internal",
      ownerModule: typedImportOwner("mutation-manifest"),
      ownerExport: "runDatasetMutationManifest",
      inputs: [
        "final rows",
        "schema report",
        "cleanup report",
        "dry-run report",
        "decision/patch evidence",
        "remote verify reports",
        "current task rules and explicit exception evidence",
      ],
      outputs: [
        "dataset-mutation-manifest.json",
        "write candidates",
        "reference reuse items",
        "blockers",
      ],
      keyTests: [
        goldenDiff,
        nodeTest(
          "test/scenarios/mutation-full-context-evidence.test.mts",
          "mutation manifest requires full-context AI evidence and preserves deferred trace queues",
        ),
        nodeTest(
          "test/scenarios/mutation-manifest-reference-closure.test.mts",
          "mutation manifest blocks process writes when referenced datasets are not proven",
        ),
        importCurationEntryContract,
      ],
    }),
  };
}
