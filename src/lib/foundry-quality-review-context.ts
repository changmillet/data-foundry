import type { FoundryInteractionState } from "./foundry-interaction-types.ts";
import { applicableFoundryInteractionDigestForObject } from "./foundry-interaction-projection.ts";
import { datasetIdentity } from "./import-curation/internal/dataset-payload.ts";
import { sha256Json } from "./identity-preflight-proof.ts";

/** Include both broad and object-scoped Process decisions, without importing other entity types. */
export function qualityReviewInteractionDigest(
  interaction: FoundryInteractionState | null,
  processRows: readonly unknown[],
): string | null {
  if (!interaction) return null;
  const scope = processRows.map((row, index) => {
    const identity = datasetIdentity(row, index, "process");
    return {
      row_index: index,
      id: identity.id,
      version: identity.version,
      interaction_sha256: applicableFoundryInteractionDigestForObject(
        interaction,
        "process",
        identity.id,
        identity.version,
      ),
    };
  });
  return scope.some((item) => item.interaction_sha256 !== null) ? sha256Json(scope) : null;
}
