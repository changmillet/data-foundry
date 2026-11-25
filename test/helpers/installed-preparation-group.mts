import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { managedPreparationGroups } from "./managed-process-preparation.mts";
import { verifyManagedPackageHost } from "./managed-package-host.mts";
import { materializeIsolatedInstalledProject } from "./shared-installed-package-template.mts";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function mode(root: string, writable: boolean): void {
  if (!fs.existsSync(root)) return;
  fs.chmodSync(root, writable ? 0o755 : 0o555);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) mode(target, writable);
    else if (entry.isFile()) fs.chmodSync(target, writable ? 0o644 : 0o444);
    else throw new Error("Installed production package must not contain links.");
  }
}

/** Each group materializes an isolated regular-file production closure from the verified snapshot template. */
export async function verifyInstalledPreparationGroup(
  t: TestContext,
  group: keyof typeof managedPreparationGroups,
): Promise<void> {
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), `foundry-installed-preparation-${group}-`),
    ),
  );
  const project = path.join(root, "project");
  const installedPackage = path.join(project, "node_modules/@tiangong-lca/foundry");
  t.after(() => {
    mode(installedPackage, true);
    mode(path.join(root, "managed-process-case/input/node_modules/@tiangong-lca/foundry"), true);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const template = materializeIsolatedInstalledProject(project);
  const manifestBytes = fs.readFileSync(path.join(installedPackage, "package.json"));
  const manifest = JSON.parse(manifestBytes.toString()) as {
    version: string;
    dependencies: Record<string, string>;
  };
  const cliVersion = template.cliVersion;
  assert.match(cliVersion, /^\d+\.\d+\.\d+$/u);
  assert.equal(manifest.dependencies["@tiangong-lca/cli"], cliVersion);
  const cli = JSON.parse(
    fs.readFileSync(path.join(project, "node_modules/@tiangong-lca/cli/package.json"), "utf8"),
  ) as { version: string };
  assert.equal(cli.version, cliVersion);
  mode(installedPackage, false);
  await verifyManagedPackageHost(
    installedPackage,
    root,
    process.env.FOUNDRY_QUALIFICATION_PUBLIC_TIDAS_BIN,
    managedPreparationGroups[group],
  );
  assert.deepEqual(fs.readFileSync(path.join(installedPackage, "package.json")), manifestBytes);
  const cases = JSON.parse(
    fs.readFileSync(
      path.join(root, "managed-process-case/managed-process-preparation-receipt.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    cases.map((item: { case: string }) => item.case).sort(),
    [...managedPreparationGroups[group]].sort(),
  );
  if (process.env.FOUNDRY_QUALIFICATION_RECEIPT) {
    const binary = process.env.FOUNDRY_QUALIFICATION_PUBLIC_TIDAS_BIN;
    fs.writeFileSync(
      `${process.env.FOUNDRY_QUALIFICATION_RECEIPT}-${group}.json`,
      JSON.stringify(
        {
          schema: "tiangong-foundry.installed-process-preparation-qualification.v1",
          group,
          foundry_version: manifest.version,
          cli_version: cli.version,
          native_kind: binary ? "verified-public-executable" : "explicit-transport-fixture",
          native_sha256: binary ? digest(fs.readFileSync(binary)) : null,
          source_snapshot_sha256: template.sourceSnapshotSha256,
          installed_package_manifest_sha256: digest(manifestBytes),
          cases,
        },
        null,
        2,
      ),
    );
  }
}
