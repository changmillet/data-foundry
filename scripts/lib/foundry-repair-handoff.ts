import path from "node:path";
import { createFileArtifactFact, createFoundryCommandSpec } from "@tiangong-lca/cli/command-spec";
import {
  nativeDraftCommitArguments,
  readNativeDraftHandoff,
} from "./finalize-owners/native-draft-handoff.ts";
import type { FoundryRuntimeContext } from "./foundry-runtime-context.ts";
import { resolveInstalledTiangongLcaCliPackage } from "./foundry-runtime-utils.ts";

type JsonRecord = Record<string, unknown>;

/**
 * The reviewed owner-draft write plan of one prepared repair. It is the repair counterpart of the
 * finalization commit handoff: the same native save-draft commit CommandSpec plus its post-write
 * verification, bound to the candidate rows and the selected execution contract. The plan carries the
 * admitted native contract metadata unchanged, so the closeout owner can consume it. Nothing is
 * dispatched here, and the plan is not authority by itself.
 */
export function createFoundryRepairHandoffPlan(input: {
  context: FoundryRuntimeContext;
  candidateFile: string;
  contractFile: string;
  outDir: string;
}): JsonRecord {
  const account = input.context.accountIntent;
  if (!account) throw new Error("A repair handoff plan requires the current account intent.");
  const relativePath = (file: string) => path.relative(input.context.assetRoot, file);
  const native = readNativeDraftHandoff({
    contractFile: input.contractFile,
    rowsFile: input.candidateFile,
    datasetType: "process",
    targetUserId: account.userId,
    verifiedProjectRef: account.projectRef,
    stateCode: "0",
    relativePath,
  });
  const approved = createFileArtifactFact({
    role: "final_rows",
    path: relativePath(input.candidateFile),
    filePath: input.candidateFile,
  });
  if (native.rows_sha256 !== approved.sha256)
    throw new Error(
      "--execution-contract-file repair candidate rows changed during handoff admission.",
    );
  const cli = resolveInstalledTiangongLcaCliPackage();
  const prefix = [process.execPath, cli.binPath];
  const commit = nativeDraftCommitArguments(
    prefix,
    "process",
    input.candidateFile,
    input.outDir,
    input.contractFile,
  );
  const verify = [
    ...prefix,
    "dataset",
    "verify-remote",
    "--input",
    input.candidateFile,
    "--out-dir",
    path.join(input.outDir, "post-write-verify"),
    "--root-policy",
    "candidate",
    "--compare-root-payload",
    "--json",
    "--target-user-id",
    account.userId,
    "--state-code",
    "0",
  ];
  const bound = [approved, native.artifact];
  const report: JsonRecord = {
    schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    status: "ready_for_explicit_commit",
    dataset_type: "process",
    profile: "generic",
    remote_write_mode: "read-only",
    repair_scope: true,
    final_rows_file: input.candidateFile,
    final_rows_artifact: approved,
    target_user_id: account.userId,
    verified_project_ref: account.projectRef,
    account_mode: account.accountMode ?? "ordinary",
    expected_state_code: "0",
    execution_contract: { ...native.metadata },
    account_write_guard: {
      target_user_id_required: true,
      target_user_id: account.userId,
      commit_command_supports_target_user_id: true,
      commit_account_binding: "native_execution_contract",
      verify_account_binding: "target_user_id_cli_argument",
      execution_precondition:
        "Run only the exact native execution contract under its matching owner/project session; the CLI owns persistent attempt and readback-only recovery.",
    },
    policy: {
      commit_boundary:
        "This plan does not write the database. The sealed owner execution request runs the authoritative commit CommandSpec, then the post_write_verify CommandSpec, without a shell.",
      post_write_verify_required: true,
      compare_root_payload_required: true,
    },
    blockers: [],
    commands: {
      commit: createFoundryCommandSpec({
        executable: commit[0],
        argv: commit.slice(1),
        binding: { artifacts: bound },
      }),
      post_write_verify: createFoundryCommandSpec({
        executable: verify[0],
        argv: verify.slice(1),
        binding: { artifacts: bound },
      }),
    },
    files: {
      expected_commit_report_dir: path.join(input.outDir, "commit"),
      expected_post_write_verify_dir: path.join(input.outDir, "post-write-verify"),
    },
  };
  return {
    ...report,
    files: {
      ...(report.files as JsonRecord),
      report: relativePath(path.join(input.outDir, "dataset-commit-handoff-plan.json")),
    },
  };
}
