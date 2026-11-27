import { foundryPlatformTestShards, type FoundryTestPlan } from "./foundry-ci-plan.ts";

export const foundryCiPlatforms = [
  "linux-x64",
  "linux-arm64",
  "darwin-arm64",
  "win32-x64",
] as const;
const countKeys = ["tests", "passed", "failed", "cancelled", "skipped", "todo", "suites"] as const;
type Counts = Record<(typeof countKeys)[number], number>;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid CI shard evidence.");
  return value as Record<string, unknown>;
}

export function verifyFoundryTestShards(
  records: readonly unknown[],
  source: string,
  plan: FoundryTestPlan,
  selectedPlatforms: readonly (typeof foundryCiPlatforms)[number][] = foundryCiPlatforms,
) {
  const platforms = [...new Set(selectedPlatforms)];
  if (
    !platforms.length ||
    platforms.length !== selectedPlatforms.length ||
    platforms.some((platform) => !foundryCiPlatforms.includes(platform))
  )
    throw new Error("Invalid CI platform selection.");
  if (
    !/^[0-9a-f]{40}$/u.test(source) ||
    records.length !==
      platforms.reduce((n, platform) => n + foundryPlatformTestShards(plan, platform).length, 0)
  )
    throw new Error("Incomplete CI shard set.");
  const seen = new Set<string>();
  const totals = Object.fromEntries(
    platforms.map((platform) => [
      platform,
      Object.fromEntries(countKeys.map((key) => [key, 0])) as Counts,
    ]),
  ) as Partial<Record<(typeof foundryCiPlatforms)[number], Counts>>;
  for (const item of records) {
    const row = object(item);
    const platform = platforms.find((value) => value === row.platform);
    const selectedShards = platform ? foundryPlatformTestShards(plan, platform) : [];
    const shard = selectedShards.find((value) => value.index === row.index);
    if (
      row.schema !== "tiangong-foundry.ci-test-shard.v1" ||
      row.status !== "passed" ||
      !platform ||
      !shard ||
      row.total !== selectedShards.length ||
      row.source !== source ||
      row.plan_sha256 !== plan.planSha256 ||
      !Array.isArray(row.errors) ||
      row.errors.length ||
      JSON.stringify(row.files) !== JSON.stringify(shard.files)
    )
      throw new Error("CI shard source, plan, inventory or outcome differs.");
    const identity = `${platform}/${shard.index}`;
    if (seen.has(identity)) throw new Error("Duplicate CI shard evidence.");
    seen.add(identity);
    const counts = object(row.counts);
    const platformTotals = totals[platform];
    if (!platformTotals) throw new Error("Invalid CI platform selection.");
    for (const key of countKeys) {
      const value = counts[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        throw new Error("Invalid CI test counts.");
      platformTotals[key] += value;
    }
    if (counts.failed !== 0 || counts.cancelled !== 0 || counts.tests === 0)
      throw new Error("CI shard did not finish its tests.");
  }
  return Object.freeze({
    schema: "tiangong-foundry.ci-test-summary.v1",
    source,
    plan_sha256: plan.planSha256,
    files_per_platform: plan.shards.reduce((total, shard) => total + shard.files.length, 0),
    platforms: totals as Record<(typeof foundryCiPlatforms)[number], Counts>,
  });
}
