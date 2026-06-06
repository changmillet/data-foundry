import {
  testTmpRoot,
} from "./foundry-core.mjs";

export const fixtureRoot = testTmpRoot("full-context-gate-test");
export const mutationFixtureRoot = testTmpRoot("mutation-manifest-trace-test");
export const referenceClosureFixtureRoot = testTmpRoot(
  "mutation-manifest-reference-closure-test",
);
export const supportManifestFixtureRoot = testTmpRoot(
  "mutation-manifest-support-scope-test",
);
export const classificationFixtureRoot = testTmpRoot(
  "classification-queue-gate-test",
);
export const flowClassificationFixtureRoot = testTmpRoot(
  "flow-classification-gate-test",
);
export const elementaryFlowManifestFixtureRoot = testTmpRoot(
  "elementary-flow-manifest-gate-test",
);
export const flowIdentityReferenceFixtureRoot = testTmpRoot(
  "flow-identity-reference-reuse-test",
);
export const locationFixtureRoot = testTmpRoot("location-queue-gate-test");
export const finalizeLocationFixtureRoot = testTmpRoot(
  "finalize-location-audit-test",
);
export const finalizeCurationGateFixtureRoot = testTmpRoot(
  "finalize-curation-gate-test",
);
export const finalizeIdentityPreflightFixtureRoot = testTmpRoot(
  "finalize-identity-preflight-test",
);
export const identityPreflightRunFixtureRoot = testTmpRoot(
  "identity-preflight-run-test",
);
export const finalizeAutoQueueFixtureRoot = testTmpRoot(
  "finalize-auto-queue-test",
);
export const packageContextFixtureRoot = testTmpRoot(
  "authoring-package-context-test",
);
export const annualSupplyFixtureRoot = testTmpRoot("annual-supply-deferral-test");
export const sourceExchangeFixtureRoot = testTmpRoot(
  "source-exchange-completeness-test",
);
export const qaPathFixtureRoot = testTmpRoot("qa-path-gate-test");
