/**
 * Typed CLI runtime and cross-version compatibility capability predicates.
 *
 * Centralizes retained legacy CLI identity-preflight / manual-review diagnostic
 * allowlists and typed v0.4.0 CLI capability checks so proof, recovery, and
 * finalization modules do not duplicate hardcoded package version strings.
 */

export const RETAINED_IDENTITY_PREFLIGHT_CLI_PACKAGE_NAME = "@tiangong-lca/cli" as const;

export const RETAINED_IDENTITY_PREFLIGHT_CLI_VERSIONS = ["0.1.22", "0.1.27", "0.1.28"] as const;

export const RETAINED_IDENTITY_PREFLIGHT_CLI_PACKAGE_SPECS: readonly string[] =
  RETAINED_IDENTITY_PREFLIGHT_CLI_VERSIONS.map(
    (version) => `${RETAINED_IDENTITY_PREFLIGHT_CLI_PACKAGE_NAME}@${version}`,
  );

export const TYPED_V4_CLI_PACKAGE_VERSION = "0.4.0" as const;

export function isRetainedIdentityPreflightCliVersion(version: unknown): boolean {
  return (
    typeof version === "string" &&
    (RETAINED_IDENTITY_PREFLIGHT_CLI_VERSIONS as readonly string[]).includes(version)
  );
}

export function isRetainedIdentityPreflightCliPackageSpec(spec: unknown): boolean {
  return typeof spec === "string" && RETAINED_IDENTITY_PREFLIGHT_CLI_PACKAGE_SPECS.includes(spec);
}

export function isTypedV4CliRuntime(version: unknown): boolean {
  return version === TYPED_V4_CLI_PACKAGE_VERSION;
}
