/**
 * Desensitized reproduction of a real CLI 0.1.19 `dataset verify-remote --compare-root-payload`
 * wire for one owner Process draft.
 *
 * Provenance (read-only): `/private/tmp/foundry-remediation-20260921/process-current-closure-cli019.json`
 * plus its `outputs/remote-verification.jsonl` (24 records) and `outputs/blockers.jsonl` (2 records).
 *
 * Preserved exactly, because these are the semantics under test:
 *   status `blocked_remote_verification`, root_policy `existing`,
 *   counts rows 1 / references 23 / checked 24 / blockers 2 / root_readback_checks 1 /
 *   root_payload_mismatches 0, by_status ok 22 + version_outdated 2 (every other bucket 0),
 *   and each record's role, table, type, path, row_index, version, exact_version, latest_version
 *   and status. The root readback keeps local_payload_sha256 === remote_payload_sha256 and
 *   state_code 0.
 *
 * Redacted: every UUID, URL, address, message string and short_description, replaced by
 * deterministic synthetic values. No person, account or project text survives.
 *
 * The two `version_outdated` findings are on `contacts` references whose `exact_version` equals the
 * requested `version` while `latest_version` is one patch higher -- i.e. the requested version
 * exists exactly and simply is not the newest published one.
 */

export const RETAINED_REFERENCE_WIRE = {
  report: {
    schema_version: 1,
    generated_at_utc: "2026-09-21T08:09:39.961Z",
    status: "blocked_remote_verification",
    root_policy: "existing",
    input_path: "inputs/process.json",
    out_dir: "outputs/remote-verification",
    counts: {
      rows: 1,
      references: 23,
      checked: 24,
      blockers: 2,
      root_readback_checks: 1,
      root_payload_mismatches: 0,
      by_status: {
        ok: 22,
        lookup_failed: 0,
        missing_dataset: 0,
        missing_version: 0,
        owner_mismatch: 0,
        payload_mismatch: 0,
        remote_payload_missing: 0,
        state_code_mismatch: 0,
        unsupported_type: 0,
        version_missing: 0,
        version_outdated: 2,
      },
      by_table: {
        contacts: 3,
        flowproperties: 0,
        flows: 14,
        lciamethods: 0,
        lifecyclemodels: 0,
        processes: 2,
        sources: 5,
        unitgroups: 0,
      },
    },
    blockers: [
      {
        code: "version_outdated",
        severity: "error",
        message: "Requested dataset version is lower than the latest published version (contacts).",
        row_index: 0,
        role: "reference",
        table: "contacts",
        id: "97c718b2-dfe1-44ce-8326-8317b656b584",
        version: "01.01.000",
        latest_version: "01.01.001",
        path: "/processDataSet/administrativeInformation/dataGenerator/common:referenceToPersonOrEntityGeneratingTheDataSet",
      },
      {
        code: "version_outdated",
        severity: "error",
        message: "Requested dataset version is lower than the latest published version (contacts).",
        row_index: 0,
        role: "reference",
        table: "contacts",
        id: "abc06fa0-be8f-4d6e-8294-800e470550d8",
        version: "01.00.000",
        latest_version: "01.00.001",
        path: "/processDataSet/administrativeInformation/publicationAndOwnership/common:referenceToOwnershipOfDataSet",
      },
    ],
    files: {
      report: "outputs/remote-verification-report.json",
      checks: "outputs/remote-verification.jsonl",
      blockers: "outputs/blockers.jsonl",
    },
  },
  checks: [
    {
      row_index: 0,
      role: "root",
      table: "processes",
      type: "process data set",
      id: "df2d8b38-8c76-4ac4-8432-05da379fa4f1",
      version: "00.00.001",
      path: "/processDataSet",
      short_description: "",
      status: "ok",
      exact_version: "00.00.001",
      latest_version: "00.00.001",
      exact_source_url:
        "https://example.invalid/rest/v1/processes?id=eq.df2d8b38-8c76-4ac4-8432-05da379fa4f1&version=eq.00.00.001",
      latest_source_url:
        "https://example.invalid/rest/v1/processes?id=eq.df2d8b38-8c76-4ac4-8432-05da379fa4f1&version=eq.00.00.001",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "flows",
      type: "flow data set",
      id: "a1c68d54-0a85-4e6c-8c25-ed7eb0c35f13",
      version: "00.00.002",
      path: "/processDataSet/exchanges/exchange/0/referenceToFlowDataSet",
      short_description: "",
      status: "ok",
      exact_version: "00.00.002",
      latest_version: "00.00.002",
      exact_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.a1c68d54-0a85-4e6c-8c25-ed7eb0c35f13&version=eq.00.00.002",
      latest_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.a1c68d54-0a85-4e6c-8c25-ed7eb0c35f13&version=eq.00.00.002",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "flows",
      type: "flow data set",
      id: "4589a9a5-5483-41a3-87d2-061e3642b3f8",
      version: "01.01.002",
      path: "/processDataSet/exchanges/exchange/1/referenceToFlowDataSet",
      short_description: "",
      status: "ok",
      exact_version: "01.01.002",
      latest_version: "01.01.002",
      exact_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.4589a9a5-5483-41a3-87d2-061e3642b3f8&version=eq.01.01.002",
      latest_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.4589a9a5-5483-41a3-87d2-061e3642b3f8&version=eq.01.01.002",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "flows",
      type: "flow data set",
      id: "e0ba7f36-64da-4938-872b-08a66c90ce97",
      version: "03.00.005",
      path: "/processDataSet/exchanges/exchange/2/referenceToFlowDataSet",
      short_description: "",
      status: "ok",
      exact_version: "03.00.005",
      latest_version: "03.00.005",
      exact_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.e0ba7f36-64da-4938-872b-08a66c90ce97&version=eq.03.00.005",
      latest_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.e0ba7f36-64da-4938-872b-08a66c90ce97&version=eq.03.00.005",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "flows",
      type: "flow data set",
      id: "26cdfcce-8bde-42ff-848d-c75b2f6364c6",
      version: "01.01.003",
      path: "/processDataSet/exchanges/exchange/3/referenceToFlowDataSet",
      short_description: "",
      status: "ok",
      exact_version: "01.01.003",
      latest_version: "01.01.003",
      exact_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.26cdfcce-8bde-42ff-848d-c75b2f6364c6&version=eq.01.01.003",
      latest_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.26cdfcce-8bde-42ff-848d-c75b2f6364c6&version=eq.01.01.003",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "flows",
      type: "flow data set",
      id: "bf9d0242-b8da-4428-8c35-cb175af59659",
      version: "01.01.000",
      path: "/processDataSet/exchanges/exchange/4/referenceToFlowDataSet",
      short_description: "",
      status: "ok",
      exact_version: "01.01.000",
      latest_version: "01.01.000",
      exact_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.bf9d0242-b8da-4428-8c35-cb175af59659&version=eq.01.01.000",
      latest_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.bf9d0242-b8da-4428-8c35-cb175af59659&version=eq.01.01.000",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "flows",
      type: "flow data set",
      id: "9332afd4-3130-4aa3-83c6-d0fda684f33e",
      version: "01.01.001",
      path: "/processDataSet/exchanges/exchange/5/referenceToFlowDataSet",
      short_description: "",
      status: "ok",
      exact_version: "01.01.001",
      latest_version: "01.01.001",
      exact_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.9332afd4-3130-4aa3-83c6-d0fda684f33e&version=eq.01.01.001",
      latest_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.9332afd4-3130-4aa3-83c6-d0fda684f33e&version=eq.01.01.001",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "flows",
      type: "flow data set",
      id: "60f9d01a-664a-4f3d-880a-72e536721cb5",
      version: "03.00.004",
      path: "/processDataSet/exchanges/exchange/6/referenceToFlowDataSet",
      short_description: "",
      status: "ok",
      exact_version: "03.00.004",
      latest_version: "03.00.004",
      exact_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.60f9d01a-664a-4f3d-880a-72e536721cb5&version=eq.03.00.004",
      latest_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.60f9d01a-664a-4f3d-880a-72e536721cb5&version=eq.03.00.004",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "flows",
      type: "flow data set",
      id: "57048aea-e932-4478-8f35-301a1e6b59d5",
      version: "03.00.004",
      path: "/processDataSet/exchanges/exchange/7/referenceToFlowDataSet",
      short_description: "",
      status: "ok",
      exact_version: "03.00.004",
      latest_version: "03.00.004",
      exact_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.57048aea-e932-4478-8f35-301a1e6b59d5&version=eq.03.00.004",
      latest_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.57048aea-e932-4478-8f35-301a1e6b59d5&version=eq.03.00.004",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "flows",
      type: "flow data set",
      id: "19729a19-8ce1-4441-8b92-8dacececec35",
      version: "01.00.004",
      path: "/processDataSet/exchanges/exchange/8/referenceToFlowDataSet",
      short_description: "",
      status: "ok",
      exact_version: "01.00.004",
      latest_version: "01.00.004",
      exact_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.19729a19-8ce1-4441-8b92-8dacececec35&version=eq.01.00.004",
      latest_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.19729a19-8ce1-4441-8b92-8dacececec35&version=eq.01.00.004",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "flows",
      type: "flow data set",
      id: "3d796fdc-bb68-4900-8a27-ae62a3020d4e",
      version: "01.01.000",
      path: "/processDataSet/exchanges/exchange/9/referenceToFlowDataSet",
      short_description: "",
      status: "ok",
      exact_version: "01.01.000",
      latest_version: "01.01.000",
      exact_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.3d796fdc-bb68-4900-8a27-ae62a3020d4e&version=eq.01.01.000",
      latest_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.3d796fdc-bb68-4900-8a27-ae62a3020d4e&version=eq.01.01.000",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "flows",
      type: "flow data set",
      id: "da1db92f-3d42-490b-8158-b8f5baab7f34",
      version: "01.01.001",
      path: "/processDataSet/exchanges/exchange/10/referenceToFlowDataSet",
      short_description: "",
      status: "ok",
      exact_version: "01.01.001",
      latest_version: "01.01.001",
      exact_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.da1db92f-3d42-490b-8158-b8f5baab7f34&version=eq.01.01.001",
      latest_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.da1db92f-3d42-490b-8158-b8f5baab7f34&version=eq.01.01.001",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "flows",
      type: "flow data set",
      id: "bdad781d-e610-476d-8425-b22317cfd9fe",
      version: "01.01.002",
      path: "/processDataSet/exchanges/exchange/11/referenceToFlowDataSet",
      short_description: "",
      status: "ok",
      exact_version: "01.01.002",
      latest_version: "01.01.002",
      exact_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.bdad781d-e610-476d-8425-b22317cfd9fe&version=eq.01.01.002",
      latest_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.bdad781d-e610-476d-8425-b22317cfd9fe&version=eq.01.01.002",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "flows",
      type: "flow data set",
      id: "08cc3db5-3dc1-4761-8d28-bba9b445c893",
      version: "01.01.002",
      path: "/processDataSet/exchanges/exchange/12/referenceToFlowDataSet",
      short_description: "",
      status: "ok",
      exact_version: "01.01.002",
      latest_version: "01.01.002",
      exact_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.08cc3db5-3dc1-4761-8d28-bba9b445c893&version=eq.01.01.002",
      latest_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.08cc3db5-3dc1-4761-8d28-bba9b445c893&version=eq.01.01.002",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "flows",
      type: "flow data set",
      id: "53cb515c-2d69-4a2b-89d3-613405ee151e",
      version: "01.01.002",
      path: "/processDataSet/exchanges/exchange/13/referenceToFlowDataSet",
      short_description: "",
      status: "ok",
      exact_version: "01.01.002",
      latest_version: "01.01.002",
      exact_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.53cb515c-2d69-4a2b-89d3-613405ee151e&version=eq.01.01.002",
      latest_source_url:
        "https://example.invalid/rest/v1/flows?id=eq.53cb515c-2d69-4a2b-89d3-613405ee151e&version=eq.01.01.002",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "sources",
      type: "source data set",
      id: "0454d562-0353-4f52-844d-ee2bbea400df",
      version: "01.01.001",
      path: "/processDataSet/processInformation/technology/referenceToTechnologyPictogramme",
      short_description: "",
      status: "ok",
      exact_version: "01.01.001",
      latest_version: "01.01.001",
      exact_source_url:
        "https://example.invalid/rest/v1/sources?id=eq.0454d562-0353-4f52-844d-ee2bbea400df&version=eq.01.01.001",
      latest_source_url:
        "https://example.invalid/rest/v1/sources?id=eq.0454d562-0353-4f52-844d-ee2bbea400df&version=eq.01.01.001",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "sources",
      type: "source data set",
      id: "0454d562-0353-4f52-844d-ee2bbea400df",
      version: "01.01.001",
      path: "/processDataSet/processInformation/dataSetInformation/referenceToExternalDocumentation",
      short_description: "",
      status: "ok",
      exact_version: "01.01.001",
      latest_version: "01.01.001",
      exact_source_url:
        "https://example.invalid/rest/v1/sources?id=eq.0454d562-0353-4f52-844d-ee2bbea400df&version=eq.01.01.001",
      latest_source_url:
        "https://example.invalid/rest/v1/sources?id=eq.0454d562-0353-4f52-844d-ee2bbea400df&version=eq.01.01.001",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "sources",
      type: "source data set",
      id: "4a27a0f0-9394-40c2-8303-ccbb5ab99761",
      version: "20.20.002",
      path: "/processDataSet/modellingAndValidation/complianceDeclarations/compliance/common:referenceToComplianceSystem",
      short_description: "",
      status: "ok",
      exact_version: "20.20.002",
      latest_version: "20.20.002",
      exact_source_url:
        "https://example.invalid/rest/v1/sources?id=eq.4a27a0f0-9394-40c2-8303-ccbb5ab99761&version=eq.20.20.002",
      latest_source_url:
        "https://example.invalid/rest/v1/sources?id=eq.4a27a0f0-9394-40c2-8303-ccbb5ab99761&version=eq.20.20.002",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "sources",
      type: "source data set",
      id: "0454d562-0353-4f52-844d-ee2bbea400df",
      version: "01.01.001",
      path: "/processDataSet/modellingAndValidation/dataSourcesTreatmentAndRepresentativeness/referenceToDataSource",
      short_description: "",
      status: "ok",
      exact_version: "01.01.001",
      latest_version: "01.01.001",
      exact_source_url:
        "https://example.invalid/rest/v1/sources?id=eq.0454d562-0353-4f52-844d-ee2bbea400df&version=eq.01.01.001",
      latest_source_url:
        "https://example.invalid/rest/v1/sources?id=eq.0454d562-0353-4f52-844d-ee2bbea400df&version=eq.01.01.001",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "sources",
      type: "source data set",
      id: "78013238-c3dd-4346-815d-b6bad9c69489",
      version: "03.00.003",
      path: "/processDataSet/administrativeInformation/dataEntryBy/common:referenceToDataSetFormat",
      short_description: "",
      status: "ok",
      exact_version: "03.00.003",
      latest_version: "03.00.003",
      exact_source_url:
        "https://example.invalid/rest/v1/sources?id=eq.78013238-c3dd-4346-815d-b6bad9c69489&version=eq.03.00.003",
      latest_source_url:
        "https://example.invalid/rest/v1/sources?id=eq.78013238-c3dd-4346-815d-b6bad9c69489&version=eq.03.00.003",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "contacts",
      type: "contact data set",
      id: "abc06fa0-be8f-4d6e-8294-800e470550d8",
      version: "01.00.001",
      path: "/processDataSet/administrativeInformation/dataEntryBy/common:referenceToPersonOrEntityEnteringTheData",
      short_description: "",
      status: "ok",
      exact_version: "01.00.001",
      latest_version: "01.00.001",
      exact_source_url:
        "https://example.invalid/rest/v1/contacts?id=eq.abc06fa0-be8f-4d6e-8294-800e470550d8&version=eq.01.00.001",
      latest_source_url:
        "https://example.invalid/rest/v1/contacts?id=eq.abc06fa0-be8f-4d6e-8294-800e470550d8&version=eq.01.00.001",
      message: "Remote dataset reference status: ok.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "contacts",
      type: "contact data set",
      id: "97c718b2-dfe1-44ce-8326-8317b656b584",
      version: "01.01.000",
      path: "/processDataSet/administrativeInformation/dataGenerator/common:referenceToPersonOrEntityGeneratingTheDataSet",
      short_description: "",
      status: "version_outdated",
      exact_version: "01.01.000",
      latest_version: "01.01.001",
      exact_source_url:
        "https://example.invalid/rest/v1/contacts?id=eq.97c718b2-dfe1-44ce-8326-8317b656b584&version=eq.01.01.000",
      latest_source_url:
        "https://example.invalid/rest/v1/contacts?id=eq.97c718b2-dfe1-44ce-8326-8317b656b584&version=eq.01.01.000",
      message: "Remote dataset reference status: version_outdated.",
    },
    {
      row_index: 0,
      role: "reference",
      table: "contacts",
      type: "contact data set",
      id: "abc06fa0-be8f-4d6e-8294-800e470550d8",
      version: "01.00.000",
      path: "/processDataSet/administrativeInformation/publicationAndOwnership/common:referenceToOwnershipOfDataSet",
      short_description: "",
      status: "version_outdated",
      exact_version: "01.00.000",
      latest_version: "01.00.001",
      exact_source_url:
        "https://example.invalid/rest/v1/contacts?id=eq.abc06fa0-be8f-4d6e-8294-800e470550d8&version=eq.01.00.000",
      latest_source_url:
        "https://example.invalid/rest/v1/contacts?id=eq.abc06fa0-be8f-4d6e-8294-800e470550d8&version=eq.01.00.000",
      message: "Remote dataset reference status: version_outdated.",
    },
    {
      row_index: 0,
      role: "root",
      table: "processes",
      type: "process data set",
      id: "df2d8b38-8c76-4ac4-8432-05da379fa4f1",
      version: "00.00.001",
      path: "/processDataSet#readback",
      short_description: "",
      status: "ok",
      exact_version: "00.00.001",
      latest_version: null,
      exact_source_url:
        "https://example.invalid/rest/v1/processes?id=eq.df2d8b38-8c76-4ac4-8432-05da379fa4f1&version=eq.00.00.001",
      latest_source_url: null,
      message: "Remote dataset reference status: ok.",
      remote_user_id: "37d2de42-f180-48f9-8458-7319852b89e6",
      remote_state_code: 0,
      remote_modified_at: "2026-09-21T04:53:28.168009+00:00",
      local_payload_sha256: "f8c532b4d2ba88a505f476e95a73d2bdbfc56d03c3c9a1cc6c2b7782deaec15d",
      remote_payload_sha256: "f8c532b4d2ba88a505f476e95a73d2bdbfc56d03c3c9a1cc6c2b7782deaec15d",
    },
  ],
} as const;

/** The root payload hash the readback matches on both sides. */
export const RETAINED_REFERENCE_ROOTS = [
  {
    row_index: 0,
    path: RETAINED_REFERENCE_WIRE.checks[0].path,
    table: RETAINED_REFERENCE_WIRE.checks[0].table,
    id: RETAINED_REFERENCE_WIRE.checks[0].id,
    version: RETAINED_REFERENCE_WIRE.checks[0].version,
    payload_sha256: RETAINED_REFERENCE_WIRE.checks[23].local_payload_sha256,
  },
] as const;

/** Every reference the caller asserts is unchanged between before and candidate. */
export const RETAINED_REFERENCE_BINDINGS = RETAINED_REFERENCE_WIRE.checks
  .filter((check) => check.role === "reference")
  .map((check) => ({
    row_index: check.row_index,
    path: check.path,
    table: check.table,
    id: check.id,
    version: check.version,
  }));

export const RETAINED_REFERENCE_OWNER = RETAINED_REFERENCE_WIRE.checks[23].remote_user_id;
export const RETAINED_REFERENCE_STATE_CODE = RETAINED_REFERENCE_WIRE.checks[23].remote_state_code;
