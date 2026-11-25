import assert from "node:assert/strict";
import test from "node:test";
import {
  createLibraryBatchImportCommands,
  supportedLibraryBatchProfiles,
} from "../../src/commands/library-batch-import.ts";
import { exitCodeForCommand } from "../../src/lib/foundry-command-registry.ts";
import { runFoundry } from "../fixtures/foundry-core.ts";

test("library-batch-import dispatches bafu, uslci, and worldsteel profiles and blocks missing or unknown profiles", async () => {
  const calls: Array<{ runner: string; options: Record<string, unknown> }> = [];
  const { runLibraryBatchImport } = createLibraryBatchImportCommands({
    bafuBatchImportRunCommands: {
      runDatasetBafuBatchImportRun: async (options = {}) => {
        calls.push({ runner: "bafu", options });
        return { status: "preflight_completed", profile: "bafu" };
      },
    },
    uslciBatchImportRunCommands: {
      runDatasetUslciBatchImportRun: async (options = {}) => {
        calls.push({ runner: "uslci", options });
        return { status: "preflight_completed", profile: "uslci" };
      },
    },
    worldsteelBatchImportRunCommands: {
      runDatasetWorldsteelBatchImportRun: async (options = {}) => {
        calls.push({ runner: "worldsteel", options });
        return { status: "preflight_completed", profile: "worldsteel" };
      },
    },
  });

  const help = (await runLibraryBatchImport({ help: true })) as Record<string, unknown>;
  assert.equal(help.status, "help");
  assert.equal(help.command, "library-batch-import");
  assert.deepEqual(help.supported_profiles, [...supportedLibraryBatchProfiles]);
  assert.equal(exitCodeForCommand("library-batch-import", help), 0);

  const missingProfile = (await runLibraryBatchImport({
    preflightOnly: true,
  })) as { status: string; blockers: Array<{ code: string }> };
  assert.equal(missingProfile.status, "blocked");
  assert.equal(missingProfile.blockers[0]?.code, "missing_library_batch_profile");
  assert.equal(exitCodeForCommand("library-batch-import", missingProfile), 1);

  const unknownProfile = (await runLibraryBatchImport({
    profile: "ecoinvent",
    preflightOnly: true,
  })) as { status: string; profile: string; blockers: Array<{ code: string }> };
  assert.equal(unknownProfile.status, "blocked");
  assert.equal(unknownProfile.profile, "ecoinvent");
  assert.equal(unknownProfile.blockers[0]?.code, "unsupported_library_batch_profile");
  assert.equal(exitCodeForCommand("library-batch-import", unknownProfile), 1);

  for (const profile of supportedLibraryBatchProfiles) {
    const result = (await runLibraryBatchImport({
      profile: profile.toUpperCase(),
      preflightOnly: true,
      limit: 5,
    })) as { status: string; profile: string };
    assert.equal(result.status, "preflight_completed");
    assert.equal(result.profile, profile);
    assert.equal(exitCodeForCommand("library-batch-import", result), 0);
  }
  assert.deepEqual(
    calls.map((entry) => ({ runner: entry.runner, profile: entry.options.profile })),
    [
      { runner: "bafu", profile: "bafu" },
      { runner: "uslci", profile: "uslci" },
      { runner: "worldsteel", profile: "worldsteel" },
    ],
  );
});

test("library-batch-import CLI help and missing-profile blocker execute through dev-cli", () => {
  const helpRun = runFoundry(["library-batch-import", "--help"]);
  assert.equal(helpRun.code, 0);
  assert.equal(helpRun.json.status, "help");
  assert.equal(helpRun.json.command, "library-batch-import");

  const blockedRun = runFoundry(["library-batch-import", "--preflight-only"]);
  assert.equal(blockedRun.code, 1);
  assert.equal(blockedRun.json.status, "blocked");
  assert.equal(blockedRun.json.blockers[0]?.code, "missing_library_batch_profile");

  const profileHelpRun = runFoundry(["library-batch-import", "--profile", "worldsteel", "--help"]);
  assert.equal(profileHelpRun.code, 0);
  assert.equal(profileHelpRun.json.status, "help");
  assert.equal(profileHelpRun.json.command, "dataset-worldsteel-batch-import-run");
});
