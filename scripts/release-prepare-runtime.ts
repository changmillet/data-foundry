import { prepareFoundryRuntimeComponents } from "./lib/foundry-release-components.ts";
import {
  qualifyFoundryRuntimeComponents,
  createFoundryRuntimeCandidateEntry,
} from "./lib/foundry-release-runtime-qualification.ts";
import {
  foundryComponentJson,
  writeFoundryComponentFile,
} from "./lib/foundry-release-component-io.ts";

import path from "node:path";
import {
  adoptionFileFact,
  readAdoptionJson,
  parseAdoptionRuntimeSelection,
  createFoundryAdoptionReviewRequest,
} from "./lib/foundry-release-adoption-facts.ts";
import { completeFoundryManagedAdoptionPreparation } from "./lib/foundry-release-adoption.ts";
import type { FoundryCliCandidateSelection } from "./lib/foundry-release-cli-candidate.ts";
import type {
  FoundryRuntimeComponentSource,
  PreparedFoundryRuntimeComponents,
} from "./lib/foundry-release-components.ts";

const usage =
  "Usage: release-prepare-runtime --output <new-absolute-directory> [--published | --cli-source <absolute-clean-checkout> --cli-commit <exact-commit>] [--adoption-original <selection-file> --adoption-original-sha256 <digest>]\n       release-prepare-runtime --complete-adoption <prepared-output> --adoption-review <independent-review-file> --adoption-review-sha256 <digest>";
export function parseFoundryRuntimePreparationArgs(args: readonly string[]): {
  output: string;
  scope: FoundryRuntimeComponentSource;
  cliCandidate: FoundryCliCandidateSelection | undefined;
  adoptionOriginal?: { path: string; sha256: string };
} {
  const selected = new Map<string, string>();
  let published = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--published" && !published) {
      published = true;
      continue;
    }
    if (
      ![
        "--output",
        "--cli-source",
        "--cli-commit",
        "--adoption-original",
        "--adoption-original-sha256",
      ].includes(key) ||
      selected.has(key) ||
      !args[index + 1] ||
      args[index + 1].startsWith("--")
    )
      throw new Error(usage);
    selected.set(key, args[++index]);
  }
  const output = selected.get("--output"),
    root = selected.get("--cli-source"),
    commit = selected.get("--cli-commit");
  const original = selected.get("--adoption-original"),
    originalHash = selected.get("--adoption-original-sha256");
  if (
    !output ||
    Boolean(root) !== Boolean(commit) ||
    Boolean(original) !== Boolean(originalHash) ||
    (published && (root || original))
  )
    throw new Error(usage);
  return {
    output,
    scope: published ? "published-release" : "source-candidate",
    cliCandidate: root && commit ? { sourceRoot: root, commit } : undefined,
    ...(original && originalHash
      ? { adoptionOriginal: { path: original, sha256: originalHash } }
      : {}),
  };
}
/** Source-side completion keeps qualification selection shared by the CLI and bounded contract tests. */
export async function completeFoundryRuntimePreparation(
  prepared: PreparedFoundryRuntimeComponents,
  cliCandidate: FoundryCliCandidateSelection | undefined,
  operations = {
    qualify: qualifyFoundryRuntimeComponents,
    createEntry: createFoundryRuntimeCandidateEntry,
  },
  retainConsumerCache = Boolean(cliCandidate),
) {
  const qualification = await operations.qualify(
    prepared,
    retainConsumerCache ? { retainConsumerCache: true } : undefined,
  );
  const candidateEntry = retainConsumerCache
    ? operations.createEntry(prepared, qualification)
    : undefined;
  return { qualification, candidateEntry };
}

async function main(args: readonly string[]) {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (args[0] === "--complete-adoption") {
    if (
      args.length !== 6 ||
      args[2] !== "--adoption-review" ||
      args[4] !== "--adoption-review-sha256"
    )
      throw new Error(usage);
    const review = adoptionFileFact(args[3]);
    if (review.sha256 !== args[5])
      throw new Error("Independent adoption review digest differs from selection.");
    process.stdout.write(
      foundryComponentJson(await completeFoundryManagedAdoptionPreparation(args[1], review)),
    );
    return;
  }
  const selection = parseFoundryRuntimePreparationArgs(args);
  const originalFact = selection.adoptionOriginal
    ? adoptionFileFact(selection.adoptionOriginal.path)
    : null;
  if (originalFact && originalFact.sha256 !== selection.adoptionOriginal?.sha256)
    throw new Error("Original runtime selection differs from its independent digest.");
  const original = originalFact
    ? parseAdoptionRuntimeSelection(readAdoptionJson(originalFact))
    : null;
  const prepared = await prepareFoundryRuntimeComponents(
    selection.output,
    selection.scope,
    selection.cliCandidate,
    original ? "cli-auth" : "isolated",
  );
  const { qualification, candidateEntry } = await completeFoundryRuntimePreparation(
    prepared,
    selection.cliCandidate,
    undefined,
    Boolean(selection.cliCandidate || original),
  );
  const reviewRequest = original
    ? createFoundryAdoptionReviewRequest(prepared.output, original, {
        manifest: adoptionFileFact(path.join(prepared.output, prepared.manifest.file)),
        cache_dir: path.join(prepared.output, "consumer-cache"),
      })
    : null;
  writeFoundryComponentFile(
    prepared.output,
    "README.md",
    Buffer.from(
      `# Prepared Foundry runtime components\n\nSource: ${prepared.source.commit}\nPlatform: ${prepared.platform}\nPackage source: ${prepared.scope}\n\nThree complete file inventories and tar-gzip-ustar archives were assembled from the exact Foundry package, frozen CLI dependency graph from the ${selection.cliCandidate ? "exact selected local source" : "verified public package"} and verified official native inputs. Native public operations ran with an empty tool PATH, local archive seeds and then a warm cache. This is not proof of published download URLs or a final four-platform product release.\n\nRelease blockers: ${prepared.release_blockers.length ? prepared.release_blockers.join(", ") : "none observed for this platform input"}.\n`,
    ),
  );
  process.stdout.write(
    foundryComponentJson({
      status: "prepared",
      scope: prepared.scope,
      output: prepared.output,
      source: prepared.source.commit,
      platform: prepared.platform,
      cli: prepared.cli,
      manifest_sha256: prepared.manifest.sha256,
      components: prepared.components.map((component) => ({
        id: component.id,
        version: component.version,
        files: component.files.length,
        archive: component.archive,
      })),
      qualification: qualification.status,
      ...(candidateEntry ? { candidate_entry: candidateEntry } : {}),
      ...(reviewRequest ? { adoption_review_request: reviewRequest.fact } : {}),
      release_blockers: prepared.release_blockers,
    }),
  );
}
if (import.meta.main)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Runtime component preparation failed."}\n`,
    );
    process.exitCode = 1;
  });
