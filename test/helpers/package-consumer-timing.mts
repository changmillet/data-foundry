export const packageConsumerPhases = Object.freeze([
  "setup",
  "toolchain",
  "build-first",
  "build-second",
  "pack-first",
  "pack-second",
  "package-verify",
  "archive-first",
  "archive-reuse",
  "install-online",
  "install-offline",
  "installed-identity",
  "managed-cache",
  "managed-host",
  "api-import",
  "declarations",
  "readonly-facade",
  "source-equivalence",
  "tamper-rejection",
  "missing-cli",
  "cleanup",
] as const);

type PackageConsumerPhase = (typeof packageConsumerPhases)[number];

/** Test-only observations. Node's test result, never a timing record, owns qualification. */
export function createPackageConsumerTiming(
  diagnostic: (message: string) => void,
  now: () => number = () => performance.now(),
) {
  let active: { phase: PackageConsumerPhase; started: number } | null = null;
  let finished = false;
  const seen = new Set<PackageConsumerPhase>();

  function clock(): number {
    const value = now();
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > Number.MAX_SAFE_INTEGER
    )
      throw new Error("Invalid package consumer timing clock.");
    return value;
  }

  function record(ended: number): void {
    if (!active) return;
    const elapsed = ended - active.started;
    if (elapsed < 0 || !Number.isFinite(elapsed))
      throw new Error("Invalid package consumer timing clock.");
    const phase = active.phase;
    active = null;
    diagnostic(
      JSON.stringify({
        schema: "tiangong-foundry.package-consumer-phase.v1",
        phase,
        duration_ms: Number(elapsed.toFixed(3)),
      }),
    );
  }

  function checkpoint(phase: PackageConsumerPhase): void {
    if (!(packageConsumerPhases as readonly unknown[]).includes(phase))
      throw new Error("Invalid package consumer timing phase.");
    if (finished) throw new Error("Package consumer timing is finished.");
    if (seen.has(phase)) throw new Error("Duplicate package consumer timing phase.");
    const started = clock();
    record(started);
    seen.add(phase);
    active = { phase, started };
  }

  function finish(): void {
    if (finished) return;
    const ended = clock();
    finished = true;
    record(ended);
  }

  /** Always run the existing teardown; its original error outranks observation errors. */
  function cleanup(action: () => void): void {
    let measurementFailed = false;
    let measurementError: unknown;
    try {
      checkpoint("cleanup");
    } catch (error) {
      measurementFailed = true;
      measurementError = error;
    }
    let cleanupFailed = false;
    let cleanupError: unknown;
    try {
      action();
    } catch (error) {
      cleanupFailed = true;
      cleanupError = error;
    }
    try {
      finish();
    } catch (error) {
      if (!measurementFailed) {
        measurementFailed = true;
        measurementError = error;
      }
    }
    if (cleanupFailed) throw cleanupError;
    if (measurementFailed) throw measurementError;
  }

  return { checkpoint, finish, cleanup };
}
