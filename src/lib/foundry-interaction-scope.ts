import type { FoundryInteractionObjectScope } from "./foundry-interaction-types.ts";

const supportTypes = new Set(["contact", "source", "unitgroup", "flowproperty"]);

type Item = Readonly<Record<string, unknown>>;

export function foundryInteractionObjectKey(
  datasetType: string,
  entityId: string,
  version: string,
): string {
  return JSON.stringify([datasetType, entityId, version]);
}

export function foundryInteractionObjectProofKey(
  datasetType: string,
  entityId: string,
  version: string,
  rowSha256: string,
): string {
  return JSON.stringify([datasetType, entityId, version, rowSha256]);
}

export function foundryInteractionScopeApplies(scope: unknown, type: string): boolean {
  return scope === null || scope === type || (scope === "support" && supportTypes.has(type));
}

function objectScope(item: Item): FoundryInteractionObjectScope | null {
  if (!Object.hasOwn(item, "object_scope")) return null;
  const scope = item.object_scope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const candidate = scope as Record<string, unknown>;
  if (typeof candidate.entity_id !== "string" || typeof candidate.version !== "string") return null;
  return candidate as unknown as FoundryInteractionObjectScope;
}

export function foundryInteractionEventAppliesToObject(
  item: Item,
  type: string,
  entityId: string,
  version: string,
): boolean {
  const narrow = objectScope(item);
  if (!narrow)
    return (
      !Object.hasOwn(item, "object_scope") &&
      foundryInteractionScopeApplies(item.dataset_type, type)
    );
  return (
    item.dataset_type === type &&
    foundryInteractionObjectKey(type, narrow.entity_id, narrow.version) ===
      foundryInteractionObjectKey(type, entityId, version)
  );
}

export function sameFoundryInteractionScope(left: Item, right: Item): boolean {
  if (left.dataset_type !== right.dataset_type) return false;
  const leftNarrow = objectScope(left);
  const rightNarrow = objectScope(right);
  if (!leftNarrow || !rightNarrow)
    return !Object.hasOwn(left, "object_scope") && !Object.hasOwn(right, "object_scope");
  return (
    foundryInteractionObjectKey(
      String(left.dataset_type),
      leftNarrow.entity_id,
      leftNarrow.version,
    ) ===
    foundryInteractionObjectKey(
      String(right.dataset_type),
      rightNarrow.entity_id,
      rightNarrow.version,
    )
  );
}
