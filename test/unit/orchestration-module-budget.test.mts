import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

type ForbiddenCrossImport = {
  from: string;
  to: string;
};

type BudgetContract = {
  schema_version: 2;
  default_max_lines: number;
  owner_target_lines: number;
  semantic_stage_target_lines: number;
  pure_rule_target_lines: number;
  owner_ceiling_lines: Record<string, number>;
  semantic_module_ceiling_lines: Record<string, number>;
  debt_ceiling_lines: Record<string, number>;
  allowed_upward_imports: Record<string, string[]>;
  allowed_cycles: string[][];
  forbidden_cross_imports: ForbiddenCrossImport[];
};

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const contractPath = path.join(repoRoot, "specs", "module-budgets.json");

function trackedTypeScriptFiles(): string[] {
  return execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "src/**/*.ts",
      "devops/**/*.ts",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter((file) => Boolean(file) && fs.existsSync(path.join(repoRoot, file)))
    .sort();
}

function sourceLineCount(relativePath: string): number {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  return source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
}

function relativeImports(relativePath: string): string[] {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  return [...source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)["'](?<specifier>\.[^"']+)["']/gu)]
    .map((match) => match.groups?.specifier ?? "")
    .filter(Boolean);
}

function resolveImport(fromPath: string, specifier: string, tracked: Set<string>): string | null {
  const candidate = path
    .relative(repoRoot, path.resolve(repoRoot, path.dirname(fromPath), specifier))
    .split(path.sep)
    .join(path.posix.sep);
  for (const pathCandidate of [
    candidate,
    candidate.replace(/\.js$/u, ".ts"),
    candidate.endsWith(".ts") ? candidate : `${candidate}.ts`,
    `${candidate}/index.ts`,
  ]) {
    if (tracked.has(pathCandidate)) return pathCandidate;
  }
  return null;
}

function stronglyConnectedComponents(graph: Map<string, string[]>): string[][] {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function visit(node: string): void {
    indexes.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const neighbor of graph.get(node) ?? []) {
      if (!indexes.has(neighbor)) {
        visit(neighbor);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(neighbor)!));
      } else if (onStack.has(neighbor)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indexes.get(neighbor)!));
      }
    }

    if (lowLinks.get(node) !== indexes.get(node)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    components.push(component.sort());
  }

  for (const node of [...graph.keys()].sort()) {
    if (!indexes.has(node)) visit(node);
  }
  return components
    .filter((component) => component.length > 1)
    .sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

test("repo-wide module budgets enforce shrink-only ceilings across src/ and devops/", () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, "specs", "orchestration-module-budgets.json")),
    false,
  );
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8")) as BudgetContract;
  assert.equal(contract.schema_version, 2);
  assert.equal(contract.default_max_lines, 800);
  assert.equal(contract.owner_target_lines, 500);
  assert.equal(contract.semantic_stage_target_lines, 800);
  assert.equal(contract.pure_rule_target_lines, 1200);

  assert.deepEqual(Object.keys(contract.owner_ceiling_lines), [
    "src/commands/library-scope-workflow.ts",
    "src/commands/bafu-leaf-classification-tasks.ts",
    "src/commands/bafu-auto-authoring.ts",
    "src/commands/bafu-process-scope-e2e.ts",
    "src/commands/bafu-batch-import-run.ts",
    "src/commands/library-batch-import.ts",
  ]);

  for (const [label, table] of [
    ["owner_ceiling_lines", contract.owner_ceiling_lines],
    ["semantic_module_ceiling_lines", contract.semantic_module_ceiling_lines],
    ["debt_ceiling_lines", contract.debt_ceiling_lines],
  ] as const) {
    for (const [relativePath, ceiling] of Object.entries(table)) {
      assert.ok(
        fs.existsSync(path.join(repoRoot, relativePath)),
        `${label}: missing ${relativePath}`,
      );
      assert.ok(
        Number.isSafeInteger(ceiling) && ceiling > 0,
        `${label}: ${relativePath} has an invalid ceiling`,
      );
      if (label === "debt_ceiling_lines") {
        assert.ok(
          ceiling > contract.default_max_lines,
          `${relativePath} is at or below ${contract.default_max_lines} lines and should drop its debt entry`,
        );
      }
      assert.ok(
        sourceLineCount(relativePath) <= ceiling,
        `${relativePath} (${sourceLineCount(relativePath)} lines) exceeds ${ceiling} lines`,
      );
    }
  }

  const trackedFiles = trackedTypeScriptFiles();
  assert.ok(trackedFiles.some((file) => file.startsWith("src/")));
  assert.ok(trackedFiles.some((file) => file.startsWith("devops/")));
  for (const relativePath of trackedFiles) {
    const ceiling =
      contract.owner_ceiling_lines[relativePath] ??
      contract.semantic_module_ceiling_lines[relativePath] ??
      contract.debt_ceiling_lines[relativePath] ??
      contract.default_max_lines;
    const lines = sourceLineCount(relativePath);
    assert.ok(
      lines <= ceiling,
      `${relativePath} (${lines} lines) exceeds module budget ceiling ${ceiling}`,
    );
  }
});

test("src/lib remains below command owners, src never imports devops, and authoring SCC is the only cycle", () => {
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8")) as BudgetContract;
  assert.deepEqual(contract.forbidden_cross_imports, [{ from: "src/", to: "devops/" }]);
  const trackedFiles = trackedTypeScriptFiles();
  const tracked = new Set(trackedFiles);
  const graph = new Map<string, string[]>();
  const crossBoundaryViolations: Array<{ from: string; to: string }> = [];

  for (const relativePath of trackedFiles) {
    const resolved = relativeImports(relativePath)
      .map((specifier) => resolveImport(relativePath, specifier, tracked))
      .filter((value): value is string => Boolean(value));
    graph.set(relativePath, resolved);

    if (relativePath.startsWith("src/lib/")) {
      assert.deepEqual(
        resolved.filter((dependency) => dependency.startsWith("src/commands/")).sort(),
        [...(contract.allowed_upward_imports[relativePath] ?? [])].sort(),
        `${relativePath} changed its command-owner imports`,
      );
    }

    for (const rule of contract.forbidden_cross_imports) {
      if (!relativePath.startsWith(rule.from)) continue;
      for (const dependency of resolved) {
        if (dependency.startsWith(rule.to)) {
          crossBoundaryViolations.push({ from: relativePath, to: dependency });
        }
      }
    }
  }

  assert.deepEqual(crossBoundaryViolations, []);

  const expectedCycles = contract.allowed_cycles
    .map((component) => [...component].sort())
    .sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
  assert.deepEqual(stronglyConnectedComponents(graph), expectedCycles);
});
