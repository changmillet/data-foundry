import fs from "node:fs";
import path from "node:path";

export interface FoundryRetainedConsumerCache {
  readonly output: string;
  readonly path: string;
  readonly dev: bigint;
  readonly ino: bigint;
}
const retained = new WeakSet<object>();

/** Exclusive diagnostic cache selection; it conveys no component or task authority. */
export function createFoundryRetainedConsumerCache(output: string): FoundryRetainedConsumerCache {
  if (
    !path.isAbsolute(output) ||
    fs.realpathSync(output) !== output ||
    !fs.lstatSync(output).isDirectory()
  )
    throw new Error("Retained consumer cache requires its original physical preparation output.");
  const cache = path.join(output, "consumer-cache");
  fs.mkdirSync(cache, { mode: 0o700 });
  const stat = fs.lstatSync(cache, { bigint: true });
  const binding = Object.freeze({ output, path: cache, dev: stat.dev, ino: stat.ino });
  retained.add(binding);
  return binding;
}

export function assertFoundryRetainedConsumerCache(binding: FoundryRetainedConsumerCache): void {
  if (
    !retained.has(binding) ||
    binding.path !== path.join(binding.output, "consumer-cache") ||
    fs.realpathSync(binding.output) !== binding.output
  )
    throw new Error("Retained consumer cache requires its process-local original path binding.");
  const stat = fs.lstatSync(binding.path, { bigint: true });
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.dev !== binding.dev ||
    stat.ino !== binding.ino ||
    fs.realpathSync(binding.path) !== binding.path
  )
    throw new Error("Retained consumer cache changed its original physical path binding.");
}

export function discardFoundryRetainedConsumerCache(binding: FoundryRetainedConsumerCache): void {
  try {
    assertFoundryRetainedConsumerCache(binding);
  } catch {
    return;
  }
  fs.rmSync(binding.path, { recursive: true, force: true });
}
