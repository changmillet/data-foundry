import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolvePackageManagerCommand } from "../../scripts/lib/package-manager-command.ts";

const secretKey = /(?:PASSWORD|PASSWD|TOKEN|SECRET|COOKIE|CREDENTIAL|API_?KEY|PRIVATE_?KEY)/iu;

export function isolatedEnvironment(
  home: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    NPM_CONFIG_CACHE: path.join(home, "npm-cache"),
    NPM_CONFIG_USERCONFIG: path.join(home, "npmrc"),
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_AUDIT: "false",
    COREPACK_HOME: path.join(path.dirname(home), "corepack-cache"),
    COREPACK_DEFAULT_TO_LATEST: "0",
    COREPACK_ENABLE_NETWORK: "0",
    ...extra,
  };
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "windir",
    "ComSpec",
    "COMSPEC",
    "PATHEXT",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
  ]) {
    const value = process.env[key];
    if (value !== undefined && !secretKey.test(key)) {
      if (/proxy/iu.test(key)) {
        const proxy = new URL(value);
        assert.equal(proxy.username, "", `${key} cannot carry a username`);
        assert.equal(proxy.password, "", `${key} cannot carry a password`);
      }
      environment[key] = value;
    }
  }
  assert.deepEqual(
    Object.keys(environment).filter((key) => secretKey.test(key)),
    [],
  );
  return environment;
}

export function command(
  executable: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeout = 120_000,
) {
  const result = spawnSync(executable, args, {
    shell: false,
    cwd,
    env: environment,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout,
  });
  if (result.error) throw result.error;
  return result;
}

export function packageManagerCommand(
  manager: "npm" | "pnpm",
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeout = 120_000,
) {
  const invocation = resolvePackageManagerCommand(manager, args);
  return command(invocation.executable, invocation.argv, cwd, environment, timeout);
}
