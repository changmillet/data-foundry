import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  commandMetadataEntries,
  internalStageMetadataEntries,
} from "../../src/lib/foundry-command-metadata.ts";
import {
  datasetPolicyCommands,
  internalStageCommands,
  publicCommands,
} from "../../src/lib/foundry-command-registry.ts";
import {
  goldenProjectionDigest,
  normalizeGoldenCapabilityRegistry,
  normalizeGoldenCommandSurface,
  normalizeGoldenReviewedProjection,
  normalizeGoldenSurfaceAuditCounts,
} from "../../devops/ci/foundry-golden-normalization.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const NEW_CAPABILITY_ID = "foundry.final-delivery.promote";

// Projections are derived from the repository's own sources, so these exercise the real contract
// rather than a copied fixture.
const commandList = [...publicCommands, ...datasetPolicyCommands];
const commandsBefore = [...internalStageCommands];
const publicBefore = internalStageCommands.slice(0, 15);
const policyBefore = internalStageCommands.slice(15);
const policyList = [...datasetPolicyCommands];

const capabilityRegistry = (
  JSON.parse(
    fs.readFileSync(path.join(repoRoot, "specs", "automated-lca-capability-registry.json"), "utf8"),
  ) as { capabilities: Array<Record<string, unknown>> }
).capabilities;
const capabilitiesBefore = capabilityRegistry.filter(
  (capability) => capability.id !== NEW_CAPABILITY_ID,
);

const categoryCounts = (entries: Array<{ category: string }>): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const entry of entries) counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  return counts;
};
const countsBefore = categoryCounts(internalStageMetadataEntries());
const countsAfter = categoryCounts(commandMetadataEntries());

const helpSurface = (
  commands: readonly string[],
  policies: readonly string[],
  publics: readonly string[] = publicCommands,
) => ({
  commands: [...commands],
  dataset_policy_commands: [...policies],
  public_commands: [...publics],
  ownership_note: "note",
});
const capabilitySurface = (capabilities: Array<Record<string, unknown>>) => ({
  capabilities,
  capability_count: capabilities.length,
  schema_version: 2,
  registry: "specs/automated-lca-capability-registry.json",
});

test("the reviewed command surface normalizes both states to one value", () => {
  const before = normalizeGoldenCommandSurface(
    helpSurface(commandsBefore, policyBefore, publicBefore),
  );
  const after = normalizeGoldenCommandSurface(helpSurface(commandList, policyList, publicCommands));
  assert.ok(before, "the reviewed pre-change surface must normalize");
  assert.ok(after, "the reviewed post-change surface must normalize");
  assert.deepEqual(before, after, "the reviewed pair must compare equal");
  assert.deepEqual(after.commands, ["<golden-reviewed-command-surface>"]);
  assert.deepEqual(after.dataset_policy_commands, ["<golden-reviewed-command-surface>"]);
  assert.deepEqual(after.public_commands, ["<golden-reviewed-command-surface>"]);
});

test("the reviewed capability registry normalizes both states to one value", () => {
  const before = normalizeGoldenCapabilityRegistry(capabilitySurface(capabilitiesBefore));
  const after = normalizeGoldenCapabilityRegistry(capabilitySurface(capabilityRegistry));
  assert.ok(before, "the reviewed pre-change registry must normalize");
  assert.ok(after, "the reviewed post-change registry must normalize");
  assert.deepEqual(before, after, "the reviewed pair must compare equal");
  assert.equal(after.capability_count, "<golden-reviewed-capability-registry>");
});

test("mixed before and after command partitions are not a reviewed surface", () => {
  assert.equal(
    normalizeGoldenCommandSurface(helpSurface(commandList, policyBefore, publicCommands)),
    null,
  );
  assert.equal(
    normalizeGoldenCommandSurface(helpSurface(commandsBefore, policyList, publicBefore)),
    null,
  );
  assert.equal(
    normalizeGoldenCommandSurface(helpSurface(commandList, policyList, publicBefore)),
    null,
  );
});

test("the reviewed surface-audit category tally normalizes both states to one value", () => {
  const before = normalizeGoldenSurfaceAuditCounts({ category_counts: countsBefore });
  const after = normalizeGoldenSurfaceAuditCounts({ category_counts: countsAfter });
  assert.ok(before, "the reviewed pre-change tally must normalize");
  assert.ok(after, "the reviewed post-change tally must normalize");
  assert.deepEqual(before, after, "the reviewed pair must compare equal");
  assert.deepEqual(countsAfter, { public: 9, "workflow-internal": 6 });
});

test("the dispatcher routes only the three reviewed shapes", () => {
  assert.ok(normalizeGoldenReviewedProjection(helpSurface(commandList, policyList)));
  assert.ok(normalizeGoldenReviewedProjection(capabilitySurface(capabilityRegistry)));
  assert.ok(normalizeGoldenReviewedProjection({ category_counts: countsAfter }));
  assert.equal(normalizeGoldenReviewedProjection({ unrelated: true }), null);
  assert.equal(
    normalizeGoldenReviewedProjection({ commands: ["only-a-command-list"] }),
    null,
    "a partial shape is not the reviewed help contract",
  );
});

test("an extra command beyond the reviewed surface is not normalized", () => {
  assert.equal(
    normalizeGoldenCommandSurface(helpSurface([...commandList, "extra-command"], policyList)),
    null,
  );
  assert.equal(
    normalizeGoldenCommandSurface(helpSurface(commandList, [...policyList, "extra-command"])),
    null,
  );
});

test("a command removed or reordered beyond the reviewed change is not normalized", () => {
  assert.equal(
    normalizeGoldenCommandSurface(
      helpSurface(
        commandsBefore.filter((command) => command !== "doctor"),
        policyBefore,
        publicBefore,
      ),
    ),
    null,
    "removing an unreviewed command must fail",
  );
  const reordered: string[] = commandList.map((command) => String(command));
  [reordered[0], reordered[1]] = [reordered[1] ?? "", reordered[0] ?? ""];
  assert.equal(
    normalizeGoldenCommandSurface(helpSurface(reordered, policyList)),
    null,
    "array order is part of the contract",
  );
});

test("a changed public partition is not normalized away", () => {
  const changed = { ...helpSurface(commandList, policyList), public_commands: [] };
  assert.equal(normalizeGoldenCommandSurface(changed), null);
});

test("a modified or extra capability is not normalized", () => {
  const modified = structuredClone(capabilityRegistry);
  const target = modified[1];
  assert.ok(target);
  target.remote_write_mode = "tampered";
  assert.equal(normalizeGoldenCapabilityRegistry(capabilitySurface(modified)), null);

  assert.equal(
    normalizeGoldenCapabilityRegistry(
      capabilitySurface([...capabilityRegistry, { id: "foundry.extra", class: "extra" }]),
    ),
    null,
  );
  assert.equal(
    normalizeGoldenCapabilityRegistry(
      capabilitySurface(capabilityRegistry.filter((_, index) => index !== 4)),
    ),
    null,
    "removing an unreviewed capability must fail",
  );
});

test("a capability count that disagrees with the registry is not normalized", () => {
  const surface = capabilitySurface(capabilityRegistry);
  assert.equal(
    normalizeGoldenCapabilityRegistry({
      ...surface,
      capability_count: capabilityRegistry.length + 1,
    }),
    null,
    "a count-only drift must fail",
  );
  assert.equal(
    normalizeGoldenCapabilityRegistry({
      ...surface,
      capability_count: capabilityRegistry.length - 1,
    }),
    null,
  );
});

test("a wrong category tally is not normalized", () => {
  for (const wrong of [
    { ...countsAfter, "workflow-internal": countsAfter["workflow-internal"] + 2 },
    { ...countsAfter, "workflow-internal": countsAfter["workflow-internal"] - 2 },
    { ...countsAfter, public: countsAfter.public + 1 },
    { ...countsAfter, "cli-wrapper": 1 },
    { ...countsAfter, "extra-category": 1 },
  ]) {
    assert.equal(
      normalizeGoldenSurfaceAuditCounts({ category_counts: wrong }),
      null,
      JSON.stringify(wrong),
    );
  }
  assert.equal(
    normalizeGoldenSurfaceAuditCounts({ category_counts: { public: 9 } }),
    null,
    "a tally missing the workflow-internal entry is not the reviewed contract",
  );
});

test("digests bind canonical content rather than object key order", () => {
  assert.equal(
    goldenProjectionDigest({ public: 15, "workflow-internal": 45, "cli-wrapper": 4 }),
    goldenProjectionDigest({ "cli-wrapper": 4, public: 15, "workflow-internal": 45 }),
  );
  assert.notEqual(
    goldenProjectionDigest(["a", "b"]),
    goldenProjectionDigest(["b", "a"]),
    "array order stays significant",
  );
});
