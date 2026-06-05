import process from "node:process";
import { defaultCanonicalFlowPropertyMappings } from "../lib/canonical-support-mappings.mjs";

const defaultCanonicalSupportCacheFile =
  "specs/canonical-support/flow-properties-unit-groups.json";

export function createSupportCacheCommands({
  asText,
  ensureArray,
  fileExists,
  nowIso,
  readJson,
  repoRelativePath,
  resolveRepoPath,
  supportText,
  writeJson,
}) {
  function deriveSupabaseProjectBaseUrl(apiBaseUrl) {
    const normalized = asText(apiBaseUrl).replace(/\/+$/u, "");
    if (normalized.endsWith("/functions/v1"))
      return normalized.replace(/\/functions\/v1$/u, "");
    if (normalized.endsWith("/rest/v1"))
      return normalized.replace(/\/rest\/v1$/u, "");
    if (/^https?:\/\/[^/]+$/u.test(normalized)) return normalized;
    throw new Error(
      "Cannot derive Supabase project URL from TIANGONG_LCA_API_BASE_URL.",
    );
  }

  function decodeUserApiKey(userApiKey) {
    try {
      const decoded = JSON.parse(
        Buffer.from(asText(userApiKey), "base64").toString("utf8"),
      );
      const email = asText(decoded.email);
      const password = asText(decoded.password);
      if (!email || !password) throw new Error("missing email/password");
      return { email, password };
    } catch (error) {
      throw new Error(`Invalid TIANGONG_LCA_API_KEY user credentials: ${error}`);
    }
  }

  async function supabaseJsonRequest(url, init) {
    const response = await fetch(url, init);
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new Error(
          `Supabase request returned non-JSON ${response.status} ${response.statusText}: ${text.slice(
            0,
            300,
          )}`,
        );
      }
    }
    if (!response.ok) {
      throw new Error(
        `Supabase request failed ${response.status} ${response.statusText}: ${text}`,
      );
    }
    return { response, payload };
  }

  async function signInSupabaseUser({
    projectUrl,
    publishableKey,
    credentials,
  }) {
    const { payload } = await supabaseJsonRequest(
      `${projectUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: publishableKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password,
        }),
      },
    );
    const accessToken = asText(payload?.access_token);
    const userId = asText(payload?.user?.id);
    if (!accessToken || !userId) {
      throw new Error("Supabase auth did not return access_token and user.id.");
    }
    return { accessToken, userId, email: credentials.email };
  }

  function supabaseRestHeaders({ publishableKey, accessToken, prefer = null }) {
    return {
      apikey: publishableKey,
      authorization: `Bearer ${accessToken}`,
      ...(prefer ? { prefer } : {}),
    };
  }

  async function fetchSupportCacheRows({
    projectUrl,
    publishableKey,
    accessToken,
    table,
    stateCode,
  }) {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const url = new URL(`${projectUrl}/rest/v1/${table}`);
      url.searchParams.set("select", "id,version,state_code,json");
      url.searchParams.set("state_code", `eq.${stateCode}`);
      url.searchParams.set("order", "id.asc,version.asc");
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(offset));
      const { payload } = await supabaseJsonRequest(url, {
        headers: supabaseRestHeaders({ publishableKey, accessToken }),
      });
      if (!Array.isArray(payload)) {
        throw new Error(
          `List rows failed for ${table}: response is not an array.`,
        );
      }
      rows.push(...payload);
      if (payload.length < pageSize) break;
    }
    return rows;
  }

  function summarizeFlowPropertySupportRow(row) {
    const root = row?.json?.flowPropertyDataSet ?? {};
    const info = root.flowPropertiesInformation ?? {};
    const data = info.dataSetInformation ?? {};
    const referenceUnitGroup =
      info.quantitativeReference?.referenceToReferenceUnitGroup ?? {};
    return {
      id: asText(row?.id),
      version: asText(row?.version),
      state_code: typeof row?.state_code === "number" ? row.state_code : null,
      name: supportText(data["common:name"] ?? data["common:shortName"]),
      short_description: supportText(
        data["common:shortName"] ?? data["common:name"],
      ),
      classification: supportText(
        data.classificationInformation?.["common:classification"]?.[
          "common:class"
        ],
      ),
      reference_unit_group: {
        id: asText(referenceUnitGroup["@refObjectId"]),
        version: asText(referenceUnitGroup["@version"]),
        short_description: supportText(
          referenceUnitGroup["common:shortDescription"],
        ),
      },
    };
  }

  function summarizeUnitGroupSupportRow(row) {
    const root = row?.json?.unitGroupDataSet ?? {};
    const info = root.unitGroupInformation ?? {};
    const data = info.dataSetInformation ?? {};
    const units = ensureArray(root.units?.unit).map((unit) => ({
      internal_id: asText(unit?.["@dataSetInternalID"]),
      name: supportText(unit?.name ?? unit?.["common:name"]),
      mean_value: asText(unit?.meanValue),
    }));
    return {
      id: asText(row?.id),
      version: asText(row?.version),
      state_code: typeof row?.state_code === "number" ? row.state_code : null,
      name: supportText(data["common:name"] ?? data["common:shortName"]),
      short_description: supportText(
        data["common:shortName"] ?? data["common:name"],
      ),
      classification: supportText(
        data.classificationInformation?.["common:classification"]?.[
          "common:class"
        ],
      ),
      reference_unit:
        info.quantitativeReference?.referenceToReferenceUnit ?? null,
      units,
    };
  }

  async function runDatasetSupportCacheRefresh(options) {
    if (options.help) {
      return {
        schema_version: 1,
        status: "help",
        command: "dataset-support-cache-refresh",
        usage: [
          "node scripts/foundry.mjs dataset-support-cache-refresh --out specs/canonical-support/flow-properties-unit-groups.json",
        ],
        purpose:
          "Refresh the small canonical Flow Properties and Unit Groups cache used to select existing database support rows instead of creating account-local support rows.",
        remote_write_mode: "read-only",
      };
    }

    const projectUrl = deriveSupabaseProjectBaseUrl(
      process.env.TIANGONG_LCA_API_BASE_URL,
    );
    const publishableKey = asText(
      process.env.TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY,
    );
    const credentials = decodeUserApiKey(process.env.TIANGONG_LCA_API_KEY);
    if (!publishableKey) {
      throw new Error("TIANGONG_LCA_SUPABASE_PUBLISHABLE_KEY is required.");
    }
    const session = await signInSupabaseUser({
      projectUrl,
      publishableKey,
      credentials,
    });
    const stateCode = Number(options.stateCode ?? 100);
    const outPath = resolveRepoPath(
      options.out ||
        options.output ||
        options.cacheFile ||
        defaultCanonicalSupportCacheFile,
    );
    const existing = fileExists(outPath) ? readJson(outPath) : {};
    const [flowPropertyRows, unitGroupRows] = await Promise.all([
      fetchSupportCacheRows({
        projectUrl,
        publishableKey,
        accessToken: session.accessToken,
        table: "flowproperties",
        stateCode,
      }),
      fetchSupportCacheRows({
        projectUrl,
        publishableKey,
        accessToken: session.accessToken,
        table: "unitgroups",
        stateCode,
      }),
    ]);
    const cache = {
      schema_version: 1,
      generated_at_utc: nowIso(),
      source: {
        table_state_code: stateCode,
        policy:
          "Flow Properties and Unit Groups are read-only support choices for Foundry imports; import rows must reference existing canonical DB rows instead of creating My Data support rows.",
      },
      flow_properties: flowPropertyRows.map(summarizeFlowPropertySupportRow),
      unit_groups: unitGroupRows.map(summarizeUnitGroupSupportRow),
      flow_property_mappings:
        ensureArray(existing.flow_property_mappings).length > 0
          ? existing.flow_property_mappings
          : defaultCanonicalFlowPropertyMappings(),
    };
    writeJson(outPath, cache);
    return {
      schema_version: 1,
      generated_at_utc: cache.generated_at_utc,
      status: "completed",
      command: "dataset-support-cache-refresh",
      remote_write_mode: "read-only",
      files: {
        cache: repoRelativePath(outPath),
      },
      counts: {
        flow_properties: cache.flow_properties.length,
        unit_groups: cache.unit_groups.length,
        flow_property_mappings: cache.flow_property_mappings.length,
      },
    };
  }

  return { runDatasetSupportCacheRefresh };
}
