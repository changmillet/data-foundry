import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const STAGE_EVAL_SCRIPT =
  "const { entryUrl, entryPath, stageArgs } = JSON.parse(process.argv[1]);" +
  "const mod = await import(entryUrl);" +
  "mod.runFoundryStageCli([process.execPath, entryPath, ...stageArgs]);";

export function resolveFoundryStageSpawnCommand(
  repoRoot: string,
  foundryEntryPath: string,
  command: readonly string[],
): { executable: string; args: string[] } {
  if (
    command.length >= 3 &&
    command[0] === process.execPath &&
    path.resolve(repoRoot, command[1] ?? "") === path.resolve(repoRoot, foundryEntryPath)
  ) {
    const entryUrl = pathToFileURL(path.resolve(repoRoot, foundryEntryPath)).href;
    return {
      executable: process.execPath,
      args: [
        "--input-type=module",
        "-e",
        STAGE_EVAL_SCRIPT,
        JSON.stringify({
          entryUrl,
          entryPath: command[1],
          stageArgs: command.slice(2),
        }),
      ],
    };
  }
  return {
    executable: command[0] ?? process.execPath,
    args: [...command.slice(1)],
  };
}
