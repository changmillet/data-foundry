import {
  path,
  rel,
  writeJson,
  writeJsonLines,
} from "./foundry-core.mjs";

export function writeCompletedIdentityPreflightIndex(root, rows) {
  const requestsRoot = path.join(root, "identity-preflight-requests");
  const outputsRoot = path.join(root, "identity-preflight");
  const indexRows = rows.map((row) => {
    const datasetType = row.datasetType || row.dataset_type;
    const id = row.id || row.dataset_id;
    const version = row.version || row.dataset_version || "00.00.001";
    const plural = datasetType === "flow" ? "flows" : "processes";
    const requestFile = path.join(requestsRoot, plural, `${id}.json`);
    const reportFile = path.join(
      outputsRoot,
      plural,
      id,
      "outputs",
      "identity-decision.json",
    );
    const candidates = Array.isArray(row.candidates) ? row.candidates : [];
    const decision = row.decision || "create_new";
    const blocked = decision === "block_duplicate";
    writeJson(requestFile, {
      schema_version: 1,
      target: row.target || { id, version, name_en: row.name || "Fixture" },
      remote_candidate_search: {
        enabled: true,
        data_source: "tg",
        limit: 20,
        ...(row.filter ? { filter: row.filter } : {}),
        query: row.query || `${datasetType} name: ${row.name || "Fixture"}`,
      },
    });
    writeJson(reportFile, {
      schema_version: 1,
      kind: datasetType,
      status: row.status || (blocked ? "blocked" : "passed"),
      decision,
      confidence: row.confidence || (blocked ? "high" : "medium"),
      target: {
        id,
        version,
        names: [row.name || "Fixture"],
        fields: row.fields || {},
        exchange_signature: [],
        schema_validation: { status: "passed", issue_count: 0, issues: [] },
      },
      candidates,
      candidate_sources: [
        {
          kind: "remote_search",
          endpoint:
            datasetType === "flow"
              ? "flow_hybrid_search"
              : "process_hybrid_search",
          query: row.query || `${datasetType} name: ${row.name || "Fixture"}`,
          ...(row.filter ? { filter: row.filter } : {}),
          row_count: candidates.length,
          scanned_files: [],
        },
      ],
      findings:
        row.findings ||
        (blocked
          ? [
              {
                code: "flow_duplicate_candidate",
                severity: "blocker",
                message: "duplicate",
              },
            ]
          : []),
      blockers:
        row.blockers ||
        (blocked
          ? [
              {
                code: "flow_duplicate_candidate",
                severity: "blocker",
                message: "duplicate",
              },
            ]
          : []),
      next_action:
        row.next_action ||
        row.nextAction ||
        (blocked ? "stop_duplicate" : "materialize_new_payload"),
      files: {},
    });
    return {
      dataset_type: datasetType,
      dataset_id: id,
      dataset_version: version,
      request_file: rel(requestFile),
      output_dir: rel(path.dirname(path.dirname(reportFile))),
      expected_report_file: rel(reportFile),
      command: `tiangong-lca ${datasetType} identity-preflight --input ${path.basename(requestFile)}`,
      remote_search: {
        data_source: "tg",
        limit: 20,
        ...(row.filter ? { filter: row.filter } : {}),
        query: row.query || `${datasetType} name: ${row.name || "Fixture"}`,
      },
    };
  });
  const indexFile = path.join(requestsRoot, "identity-preflight-requests.jsonl");
  writeJsonLines(indexFile, indexRows);
  return indexFile;
}
