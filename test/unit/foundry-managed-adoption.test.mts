import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  RUNTIME_HOST_CONTEXT_PROTOCOL,
  copyTrustedRuntimeManifestBytes,
  trustRuntimeManifest,
  type RuntimeComponent,
  type RuntimeHostContext,
  type RuntimeManifest,
} from "@tiangong-lca/cli/runtime";
import {
  FOUNDRY_MANAGED_ADOPTION_PATH,
  FOUNDRY_MANAGED_ADOPTION_SCHEMA,
  prepareFoundryManagedAdoption,
} from "../../scripts/lib/foundry-managed-adoption.ts";
import { assertTrustedQualification } from "../../scripts/lib/foundry-task-runtime-adoption.ts";
import { workspaceManifestFixture } from "../helpers/foundry-runtime-manifest.mts";

const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const trusted = (value: RuntimeManifest) => trustRuntimeManifest(json(value), hash(json(value)));
const controlId = "adoption-control";
const successorPath = "metadata/successor-runtime.json";
const qualificationPath = "metadata/qualification.json";

/** Synthetic structural admission only; no package, native process, install or network work. */
function fixture(qualificationSelected = true) {
  const template = workspaceManifestFixture({ write: ["registered-tasks-v2"] }).manifest;
  const runtime = trusted({
    ...template,
    components: [...template.components, { ...template.components[0], id: "retained-toolkit" }],
    launches: [
      {
        ...template.launches[0],
        id: "foundry",
        context_protocol: RUNTIME_HOST_CONTEXT_PROTOCOL,
        argv: [{ component: "fixture", path: "bin/tool" }],
      },
      { ...template.launches[0], id: "other" },
    ],
  });
  const qualification = {
    schema: "tiangong-foundry.runtime-adoption-qualification.v1",
    original_runtime: {},
    successor_runtime: {},
    original_manifest_sha256: "1".repeat(64),
    successor_manifest_sha256: runtime.sha256,
    original_cli: {},
    successor_cli: {},
    tidas: [],
    reviewer: "independent-structural-fixture",
    evidence: [],
    allowed_changes: ["foundry", "cli"],
    runtime_manifests: [],
    original_descriptor_sha256: "2".repeat(64),
    successor_descriptor_sha256: "3".repeat(64),
  };
  const metadata = {
    schema: FOUNDRY_MANAGED_ADOPTION_SCHEMA,
    platform: runtime.manifest.components[0].platform,
    successor_manifest: { component: controlId, path: successorPath },
    launches: [
      {
        id: "foundry",
        qualification: qualificationSelected
          ? { component: controlId, path: qualificationPath }
          : null,
      },
    ],
  };
  const contents = new Map([
    [FOUNDRY_MANAGED_ADOPTION_PATH, json(metadata)],
    [successorPath, copyTrustedRuntimeManifestBytes(runtime)],
    [qualificationPath, json(qualification)],
    ...["lock.json", "sbom.json", "license.txt", "provenance.json"].map(
      (file): [string, Buffer] => [file, json({})],
    ),
  ]);
  const component = (): RuntimeComponent => {
    const files = [...contents]
      .map(([file, bytes]) => ({
        path: file,
        bytes: bytes.length,
        sha256: hash(bytes),
        mode: 420 as const,
      }))
      .sort((left, right) => left.path.localeCompare(right.path, "en"));
    return {
      ...template.components[0],
      id: controlId,
      files,
      content_sha256: hash(JSON.stringify(files)),
      protocols: [FOUNDRY_MANAGED_ADOPTION_SCHEMA],
    };
  };
  const carrier = (): RuntimeManifest => ({
    ...runtime.manifest,
    components: [...runtime.manifest.components, component()],
  });
  const context = (manifest: RuntimeManifest = carrier()): RuntimeHostContext => ({
    manifest: trusted(manifest),
    cacheDir: "/structural-fixture/cache",
    cwd: "/structural-fixture/work",
    entry: "foundry",
    host: { platform: metadata.platform, osRelease: "0.0.0", glibc: null },
  });
  const read = (ref: { component: string; path: string }) => {
    assert.equal(ref.component, controlId);
    const bytes = contents.get(ref.path);
    assert.ok(bytes, ref.path);
    return bytes;
  };
  return { runtime, qualification, metadata, contents, component, carrier, context, read };
}

test("carrier supplies the exact semantic runtime and its native process-local qualification brand", () => {
  const f = fixture();
  const result = prepareFoundryManagedAdoption(f.context(), f.read);
  assert.ok(result?.qualification);
  assert.equal(result.manifest.sha256, f.runtime.sha256);
  assert.equal(result.manifest.manifest.components.length, 2);
  assert.doesNotThrow(() =>
    assertTrustedQualification({ qualification: f.qualification }, result.qualification),
  );
  assert.throws(
    () =>
      assertTrustedQualification({ qualification: f.qualification }, { ...result.qualification! }),
    /ordinary input/u,
  );
});

test("ordinary managed runtime and an explicit null launch cannot issue an adoption qualification", () => {
  const f = fixture(false);
  assert.equal(prepareFoundryManagedAdoption(f.context(f.runtime.manifest), f.read), null);
  const result = prepareFoundryManagedAdoption(f.context(), f.read);
  assert.equal(result?.manifest.sha256, f.runtime.sha256);
  assert.equal(result?.qualification, undefined);
  assert.throws(
    () =>
      prepareFoundryManagedAdoption(f.context(), f.read, {
        component: "fixture",
        path: "license.txt",
      }),
    /rollback/u,
  );
});

test("serialized carriers and duplicate protocols cannot enter the trusted host boundary", () => {
  const f = fixture();
  const context = f.context();
  assert.throws(
    () => prepareFoundryManagedAdoption({ ...context, manifest: { ...context.manifest } }, f.read),
    /manifest/u,
  );
  const control = f.component();
  assert.throws(
    () =>
      prepareFoundryManagedAdoption(
        f.context({
          ...f.carrier(),
          components: [
            ...f.runtime.manifest.components,
            { ...control, protocols: [...control.protocols, ...control.protocols] },
          ],
        }),
        f.read,
      ),
    /protocol/u,
  );
});

test("the complete runtime component records and every execution field must match the carrier", () => {
  const f = fixture();
  const changes: [string, (value: RuntimeManifest) => RuntimeManifest][] = [
    ["product", (v) => ({ ...v, product: { ...v.product, version: "0.0.9" } })],
    [
      "minimum host",
      (v) => ({
        ...v,
        minimum_hosts: { [f.metadata.platform]: { os_release: "1.0.0", glibc: null } },
      }),
    ],
    ["workspace write", (v) => ({ ...v, workspace: { ...v.workspace, write: [] } })],
    [
      "selected isolation",
      (v) => ({
        ...v,
        launches: v.launches.map((l) =>
          l.id === "foundry" ? { ...l, environment: "cli-auth" } : l,
        ),
      }),
    ],
    [
      "unselected launch",
      (v) => ({
        ...v,
        launches: v.launches.map((l) => (l.id === "other" ? { ...l, environment: "cli-auth" } : l)),
      }),
    ],
    [
      "launch argv",
      (v) => ({
        ...v,
        launches: v.launches.map((l) =>
          l.id === "foundry" ? { ...l, argv: [...l.argv, { literal: "override" }] } : l,
        ),
      }),
    ],
    [
      "component omission",
      (v) => ({ ...v, components: v.components.filter((c) => c.id !== "retained-toolkit") }),
    ],
    [
      "extra runtime component",
      (v) => ({ ...v, components: [...v.components, { ...v.components[0], id: "unqualified" }] }),
    ],
    [
      "same legacy identity but different complete inventory",
      (v) => ({
        ...v,
        components: v.components.map((c) =>
          c.id !== "retained-toolkit"
            ? c
            : (() => {
                const files = c.files.map((file) =>
                  file.path === "bin/tool" ? { ...file, bytes: 3 } : file,
                );
                return { ...c, files, content_sha256: hash(JSON.stringify(files)) };
              })(),
        ),
      }),
    ],
    [
      "file omission",
      (v) => ({
        ...v,
        components: v.components.map((c) =>
          c.id !== "retained-toolkit"
            ? c
            : (() => {
                const files = c.files.filter((file) => file.path !== "bin/tool");
                return { ...c, files, content_sha256: hash(JSON.stringify(files)) };
              })(),
        ),
      }),
    ],
  ];
  for (const [label, change] of changes)
    assert.throws(
      () => prepareFoundryManagedAdoption(f.context(change(f.carrier())), f.read),
      /carrier|runtime/u,
      label,
    );
});

test("control admission rejects unsupported, duplicate, executable and launch-referenced components", () => {
  const f = fixture();
  const base = f.carrier();
  const control = f.component();
  const files = control.files.map((file) =>
    file.path === "license.txt" ? { ...file, mode: 493 as const } : file,
  );
  for (const [label, changed] of [
    [
      "unknown protocol",
      {
        ...base,
        components: [
          ...f.runtime.manifest.components,
          { ...control, protocols: ["tiangong-foundry.managed-adoption.v999"] },
        ],
      },
    ],
    [
      "duplicate control",
      { ...base, components: [...base.components, { ...control, id: "duplicate-control" }] },
    ],
    [
      "extra control protocol",
      {
        ...base,
        components: [
          ...f.runtime.manifest.components,
          { ...control, protocols: [...control.protocols, "unknown.v1"] },
        ],
      },
    ],
    [
      "executable file",
      {
        ...base,
        components: [
          ...f.runtime.manifest.components,
          { ...control, files, content_sha256: hash(JSON.stringify(files)) },
        ],
      },
    ],
    [
      "control launch reference",
      {
        ...base,
        launches: base.launches.map((launch) =>
          launch.id === "other"
            ? { ...launch, argv: [{ component: controlId, path: FOUNDRY_MANAGED_ADOPTION_PATH }] }
            : launch,
        ),
      },
    ],
  ] satisfies [string, RuntimeManifest][])
    assert.throws(
      () => prepareFoundryManagedAdoption(f.context(changed), f.read),
      /managed|carrier|control/u,
      label,
    );
});

test("metadata cannot select another component, absent or duplicate launch, foreign platform or unknown fields", () => {
  const f = fixture();
  for (const value of [
    { ...f.metadata, successor_manifest: { component: "fixture", path: "license.txt" } },
    {
      ...f.metadata,
      launches: [
        { ...f.metadata.launches[0], qualification: { component: "fixture", path: "license.txt" } },
      ],
    },
    { ...f.metadata, launches: [] },
    { ...f.metadata, launches: [f.metadata.launches[0], f.metadata.launches[0]] },
    { ...f.metadata, launches: [{ ...f.metadata.launches[0], id: "missing" }] },
    { ...f.metadata, launches: [{ ...f.metadata.launches[0], id: "other" }] },
    { ...f.metadata, platform: "win32-x64" },
    { ...f.metadata, task_id: "not-authority" },
  ]) {
    f.contents.set(FOUNDRY_MANAGED_ADOPTION_PATH, json(value));
    assert.throws(
      () => prepareFoundryManagedAdoption(f.context(), f.read),
      /managed|control|launch/u,
    );
  }
});

test("raw inventory digests and the exact successor manifest cannot drift", () => {
  for (const file of [FOUNDRY_MANAGED_ADOPTION_PATH, successorPath, qualificationPath]) {
    const f = fixture();
    const context = f.context();
    f.contents.set(file, Buffer.concat([f.contents.get(file)!, Buffer.from(" ")]));
    assert.throws(
      () => prepareFoundryManagedAdoption(context, f.read),
      /changed|digest|inventory/u,
      file,
    );
  }
  const f = fixture();
  f.contents.set(
    qualificationPath,
    json({ ...f.qualification, successor_manifest_sha256: "0".repeat(64) }),
  );
  assert.throws(() => prepareFoundryManagedAdoption(f.context(), f.read), /successor|runtime/u);
});
