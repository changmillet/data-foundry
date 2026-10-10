import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import {
  createFoundryRuntimeContext,
  initializeFoundryWorkspace,
  FoundryContextError,
} from "../../scripts/lib/foundry-runtime-context.ts";
import { planFoundryWorkspaceMigration } from "../../scripts/lib/foundry-migration-plan.ts";
import {
  stageFoundryMigration,
  auditFoundryMigration,
} from "../../scripts/lib/foundry-migration-transfer.ts";
import { transferFileFact } from "../../scripts/lib/foundry-migration-transfer-io.ts";

function setup(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-unit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source"),
    dest = path.join(root, "destination");
  fs.mkdirSync(path.join(source, ".foundry/workspaces/one/attempts"), { recursive: true });
  fs.mkdirSync(path.join(source, "tasks/done"), { recursive: true });
  const attempt = path.join(source, ".foundry/workspaces/one/attempts/state.json"),
    queue = path.join(source, "tasks/done/one.md"),
    input = path.join(root, "data.json");
  fs.writeFileSync(attempt, '{"state":"UNKNOWN_DO_NOT_REPLAY"}\n');
  fs.writeFileSync(queue, "# Completed historical task\n");
  fs.writeFileSync(input, '{"flowDataSet":{}}\n');
  const ctxOptions = {
    moduleUrl: pathToFileURL(path.resolve(import.meta.dirname, "../../scripts/public-api.ts")).href,
    workspace: dest,
    cacheBase: path.join(root, "cache"),
  };
  const context = createFoundryRuntimeContext(ctxOptions),
    options = {
      sourceWorkspace: source,
      actorId: "actor-one",
      requestId: "transfer-one",
      externalInputs: [input],
    };
  return {
    root,
    source,
    dest,
    attempt,
    queue,
    input,
    ctxOptions,
    context,
    options,
    plan: planFoundryWorkspaceMigration(context, options),
  };
}
const code = (value: string) => (e: unknown) =>
  e instanceof FoundryContextError && e.code === value;

test("interrupted transfers retain a pending marker, preserve source and resume identical file copies", async (t) => {
  for (const stop of ["claimed", "copied", "audited"] as const) {
    const f = setup(t),
      original = fs.readFileSync(f.attempt);
    await assert.rejects(
      stageFoundryMigration(f.context, f.options, f.plan, {
        checkpoint: (phase, index) => {
          if (phase === stop && (phase !== "copied" || index === 1))
            throw new Error("injected_stop");
        },
      }),
      /injected_stop/u,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(f.dest, ".foundry/workspace.json"), "utf8")).schema,
      "tiangong-foundry.workspace-migration-pending.v1",
    );
    assert.throws(
      () => initializeFoundryWorkspace(createFoundryRuntimeContext(f.ctxOptions)),
      code("workspace_migration_pending"),
    );
    assert.deepEqual(fs.readFileSync(f.attempt), original);
    const resumed = await stageFoundryMigration(
      createFoundryRuntimeContext(f.ctxOptions),
      f.options,
      f.plan,
    );
    assert.equal(resumed.receipt.files.length, 3);
    assert.equal(resumed.receipt.activated, false);
    const again = await stageFoundryMigration(
      createFoundryRuntimeContext(f.ctxOptions),
      f.options,
      f.plan,
    );
    assert.deepEqual(again, resumed);
    assert.deepEqual(
      auditFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
      resumed,
    );
  }
});

test("source or destination drift during transfer prevents a successful receipt", async (t) => {
  const f = setup(t);
  await assert.rejects(
    stageFoundryMigration(f.context, f.options, f.plan, {
      checkpoint: (phase, index) => {
        if (phase === "copied" && index === 1) fs.appendFileSync(f.queue, "changed\n");
      },
    }),
  );
  assert.equal(
    fs.existsSync(path.join(f.dest, ".foundry/migrations", f.plan.plan_sha256, "receipt.json")),
    false,
  );
  await assert.rejects(
    stageFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
  );
  const g = setup(t);
  await assert.rejects(
    stageFoundryMigration(g.context, g.options, g.plan, {
      checkpoint: (phase) => {
        if (phase === "audited")
          fs.writeFileSync(
            path.join(
              g.dest,
              ".foundry/migrations",
              g.plan.plan_sha256,
              "original/tasks/done/one.md",
            ),
            "tampered",
          );
      },
    }),
    code("migration_audit_failed"),
  );
  assert.equal(
    fs.existsSync(path.join(g.dest, ".foundry/migrations", g.plan.plan_sha256, "receipt.json")),
    false,
  );
});

test("receipt publication remnants recover before and after the immutable receipt appears", async (t) => {
  for (const published of [false, true]) {
    const f = setup(t);
    if (published) await stageFoundryMigration(f.context, f.options, f.plan);
    else
      await assert.rejects(
        stageFoundryMigration(f.context, f.options, f.plan, {
          checkpoint: (phase) => {
            if (phase === "audited") throw new Error("before_receipt");
          },
        }),
        /before_receipt/u,
      );
    const base = path.join(f.dest, ".foundry/migrations", f.plan.plan_sha256),
      temporary = path.join(base, "scratch/write-00000000-0000-4000-8000-000000000001.tmp");
    // These are the durable states left by termination during write or after link.
    if (published) fs.linkSync(path.join(base, "receipt.json"), temporary);
    else fs.writeFileSync(temporary, "partial receipt");
    const resumed = await stageFoundryMigration(
      createFoundryRuntimeContext(f.ctxOptions),
      f.options,
      f.plan,
    );
    assert.equal(fs.existsSync(temporary), false);
    assert.equal(resumed.receipt.activated, false);
    assert.equal(resumed.receipt.files.length, 3);
    assert.deepEqual(
      auditFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
      resumed,
    );
  }
});

test("completed transfer audit rejects corruption or deletion without restoring a fresh history", async (t) => {
  const f = setup(t),
    staged = await stageFoundryMigration(f.context, f.options, f.plan);
  const file = path.join(f.dest, ".foundry", staged.receipt.files[0].destination);
  fs.writeFileSync(file, "foreign bytes");
  assert.throws(
    () => auditFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
    code("migration_audit_failed"),
  );
  await assert.rejects(
    stageFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
    code("migration_audit_failed"),
  );
  assert.equal(fs.readFileSync(file, "utf8"), "foreign bytes");
  fs.unlinkSync(file);
  await assert.rejects(
    stageFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
  );
  assert.equal(fs.existsSync(file), false);
});

test("foreign destination state and forged transfer intent fail before publication", async (t) => {
  const f = setup(t);
  await assert.rejects(
    stageFoundryMigration(f.context, { ...f.options, actorId: "other" }, f.plan),
    code("migration_plan_changed"),
  );
  assert.equal(fs.existsSync(f.dest), false);
  fs.mkdirSync(path.join(f.dest, ".foundry"), { recursive: true });
  fs.writeFileSync(path.join(f.dest, ".foundry/keep"), "keep");
  await assert.rejects(
    stageFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
    code("migration_destination_exists"),
  );
  assert.equal(fs.readFileSync(path.join(f.dest, ".foundry/keep"), "utf8"), "keep");
});

test("concurrent staging shares the destination lock and produces one immutable receipt", async (t) => {
  const f = setup(t);
  const results = await Promise.all([
    stageFoundryMigration(f.context, f.options, f.plan),
    stageFoundryMigration(f.context, f.options, f.plan),
  ]);
  assert.deepEqual(results[0], results[1]);
});

test("migration cache locks cannot follow a link into the preserved source", async (t) => {
  const f = setup(t);
  const namespace = path.join(f.context.cacheBase, "tiangong-lca");
  fs.mkdirSync(namespace, { recursive: true });
  fs.symlinkSync(
    path.join(f.source, ".foundry"),
    path.join(namespace, "migration-locks"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    stageFoundryMigration(f.context, f.options, f.plan),
    code("migration_path_invalid"),
  );
  assert.equal(fs.existsSync(f.dest), false);
});

test("cancellation and unowned scratch data preserve the source and keep the destination inactive", async (t) => {
  const f = setup(t),
    aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    stageFoundryMigration(f.context, f.options, f.plan, { signal: aborted.signal }),
    code("operation_interrupted"),
  );
  assert.equal(fs.existsSync(f.dest), false);
  const controller = new AbortController();
  await assert.rejects(
    stageFoundryMigration(f.context, f.options, f.plan, {
      signal: controller.signal,
      checkpoint: (phase) => {
        if (phase === "copied") controller.abort();
      },
    }),
    code("operation_interrupted"),
  );
  const scratch = path.join(f.dest, ".foundry/migrations", f.plan.plan_sha256, "scratch/keep.txt");
  fs.writeFileSync(scratch, "unowned");
  await assert.rejects(
    stageFoundryMigration(createFoundryRuntimeContext(f.ctxOptions), f.options, f.plan),
    code("migration_destination_conflict"),
  );
  assert.equal(fs.readFileSync(scratch, "utf8"), "unowned");
});

test("private queue storage is omitted and external private inputs are rejected", async (t) => {
  const f = setup(t),
    privateFile = path.join(f.source, "tasks/opaque.store");
  fs.writeFileSync(privateFile, "synthetic private storage");
  const context = createFoundryRuntimeContext({
    ...f.ctxOptions,
    accountIntent: {
      projectRef: "a".repeat(20),
      userId: "00000000-0000-4000-8000-000000000001",
      sessionReference: privateFile,
    },
  });
  const plan = planFoundryWorkspaceMigration(context, f.options);
  assert.ok(plan.omitted_private_paths.includes("tasks/opaque.store"));
  assert.deepEqual(plan.blockers, []);
  const staged = await stageFoundryMigration(context, f.options, plan);
  assert.equal(staged.receipt.files.length, 3);
  assert.equal(
    staged.receipt.files.some((file) => file.source === fs.realpathSync(privateFile)),
    false,
  );
  assert.throws(() =>
    planFoundryWorkspaceMigration(context, { ...f.options, externalInputs: [privateFile] }),
  );
});

test("registered account intent is preserved while CLI account storage stays private", async (t) => {
  const f = setup(t);
  const intent = path.join(f.source, ".foundry/state/task-accounts/task-one.json");
  const session = path.join(f.source, ".foundry/state/accounts/cli-session.json");
  fs.mkdirSync(path.dirname(intent), { recursive: true });
  fs.mkdirSync(path.dirname(session), { recursive: true });
  fs.writeFileSync(
    intent,
    '{"schema":"tiangong-foundry.account-intent.v1","project_ref":"fixture"}\n',
  );
  fs.writeFileSync(session, "synthetic private account storage");
  const plan = planFoundryWorkspaceMigration(f.context, f.options);
  assert.ok(
    plan.source_inventory.entries.find((item) => item.path === "state/task-accounts/task-one.json")
      ?.sha256,
  );
  assert.equal(
    plan.source_inventory.entries.find((item) => item.path === "state/accounts/cli-session.json")
      ?.sha256,
    null,
  );
  const result = await stageFoundryMigration(f.context, f.options, plan);
  assert.ok(result.receipt.files.some((item) => item.source === fs.realpathSync(intent)));
  assert.equal(
    result.receipt.files.some((item) => item.source === fs.realpathSync(session)),
    false,
  );
});

function hashFixture(t: TestContext, content: Buffer) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retained-file-hash-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "payload");
  fs.writeFileSync(file, content);
  return { root, file, content };
}

test("retained inventory hashing stays within the payload scratch budget and hashes every byte", (t) => {
  const chunkLimit = 1024 * 1024;
  const payloads = [0, 1, 31, 4097, 65_539, chunkLimit + 17].map((size, index) =>
    hashFixture(t, Buffer.alloc(size, index + 1)),
  );
  const allocations: number[] = [];
  const allocate = Buffer.alloc.bind(Buffer);
  const allocation = t.mock.method(
    Buffer,
    "alloc",
    (size: number, fill?: string | number | Uint8Array, encoding?: BufferEncoding) => {
      allocations.push(size);
      return allocate(size, fill, encoding);
    },
  );
  for (const { file, content } of payloads)
    assert.deepEqual(transferFileFact(file), {
      path: fs.realpathSync(file),
      bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  allocation.mock.restore();
  const budget = payloads.reduce((total, { content }) => total + Math.max(1, content.length), 0);
  const allocated = allocations.reduce((total, size) => total + size, 0);
  assert.ok(allocations.length >= payloads.length);
  assert.ok(allocations.every((size) => size >= 1 && size <= chunkLimit));
  assert.ok(allocated <= budget, `${allocated} scratch bytes exceed the ${budget} payload budget`);
});

test("retained file hashing accepts fragmented reads without hashing unused scratch bytes", (t) => {
  const { file, content } = hashFixture(t, Buffer.from("qualified retained payload".repeat(3)));
  const read = fs.readSync;
  let reads = 0;
  t.mock.method(
    fs,
    "readSync",
    (fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
      reads += 1;
      return read(fd, buffer, offset, Math.min(7, length), position);
    },
  );
  assert.deepEqual(transferFileFact(file), {
    path: fs.realpathSync(file),
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  });
  assert.ok(reads > 2, "The actual hash must span several short reads");
});

test("retained file hashing rejects a premature end of read instead of publishing a prefix hash", (t) => {
  const { file } = hashFixture(t, Buffer.from("complete retained payload"));
  const read = fs.readSync;
  let first = true;
  t.mock.method(
    fs,
    "readSync",
    (fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
      if (!first) return 0;
      first = false;
      return read(fd, buffer, offset, Math.min(7, length), position);
    },
  );
  assert.throws(() => transferFileFact(file), code("migration_source_changed"));
});

for (const drift of ["empty-file growth", "truncation", "same-byte replacement"] as const)
  test(`retained file hashing rejects ${drift} during its read`, (t) => {
    const { root, file, content } = hashFixture(
      t,
      drift === "empty-file growth" ? Buffer.alloc(0) : Buffer.from("immutable retained bytes"),
    );
    const read = fs.readSync;
    let first = true;
    t.mock.method(
      fs,
      "readSync",
      (fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
        if (first) {
          first = false;
          if (drift === "empty-file growth") fs.appendFileSync(file, "changed");
          else if (drift === "truncation") fs.truncateSync(file, content.length - 3);
          else {
            fs.renameSync(file, path.join(root, "original"));
            fs.writeFileSync(file, content);
          }
        }
        return read(fd, buffer, offset, length, position);
      },
    );
    assert.throws(() => transferFileFact(file), code("migration_source_changed"));
  });

test("retained file hashing rejects the per-file size limit before allocating scratch", (t) => {
  const { file } = hashFixture(t, Buffer.alloc(0));
  fs.truncateSync(file, 64 * 1024 * 1024 + 1);
  const allocation = t.mock.method(Buffer, "alloc");
  assert.throws(() => transferFileFact(file), code("migration_file_invalid"));
  assert.equal(allocation.mock.callCount(), 0);
});

test("fresh retained facts avoid interpreted ancestor traversal for canonical regular paths", (t) => {
  const fixture = hashFixture(t, Buffer.from("fresh retained bytes"));
  const root = fs.realpathSync(fixture.root);
  const file = path.join(root, "payload");
  const canonical = fs.realpathSync(file);
  const generic = t.mock.method(fs, "realpathSync", fs.realpathSync);
  for (const content of [fixture.content, Buffer.from("changed retained bytes")]) {
    fs.writeFileSync(file, content);
    assert.deepEqual(transferFileFact(file), {
      path: canonical,
      bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  assert.equal(
    generic.mock.callCount(),
    0,
    "Canonical retained files must not repeat the interpreted absolute-ancestor walk",
  );
});

test("retained facts preserve Unicode, spaces and selected path alias spelling", (t) => {
  const fixture = hashFixture(t, Buffer.from("canonical path bytes"));
  const directory = path.join(fixture.root, "Unicode 中文 space");
  fs.mkdirSync(directory);
  const file = path.join(directory, "目标 file.txt");
  fs.writeFileSync(file, fixture.content);
  const alias = `${directory}${path.sep}.${path.sep}目标 file.txt`;
  assert.deepEqual(transferFileFact(alias), {
    path: fs.realpathSync(alias),
    bytes: fixture.content.length,
    sha256: createHash("sha256").update(fixture.content).digest("hex"),
  });
});

test("retained facts preserve the existing resolver when native path spelling differs", (t) => {
  const { file, content } = hashFixture(t, Buffer.from("retained spelling bytes"));
  const canonical = fs.realpathSync(file);
  t.mock.method(fs.realpathSync, "native", () => `${canonical}.different-native-spelling`);
  assert.deepEqual(transferFileFact(file), {
    path: canonical,
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  });
});

test("retained facts fall back after native resolution errors and still freshly hash changes", (t) => {
  const { file, content } = hashFixture(t, Buffer.from("retained fallback bytes"));
  const canonical = fs.realpathSync(file);
  t.mock.method(fs.realpathSync, "native", () => {
    throw Object.assign(new Error("synthetic native resolver unavailable"), { code: "ENOENT" });
  });
  for (const current of [content, Buffer.from("fresh fallback bytes")]) {
    fs.writeFileSync(file, current);
    assert.deepEqual(transferFileFact(file), {
      path: canonical,
      bytes: current.length,
      sha256: createHash("sha256").update(current).digest("hex"),
    });
  }
});
