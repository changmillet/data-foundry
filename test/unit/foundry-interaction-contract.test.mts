import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  advanceFoundryInteractionState,
  currentFoundryDecisionsForType,
  parseFoundryInteractionInput,
} from "../../scripts/lib/foundry-interaction-input.ts";
import { verifyFoundrySemanticInteraction } from "../../scripts/lib/foundry-semantic-interaction.ts";
import type { FoundrySemanticInput } from "../../scripts/lib/foundry-semantic-input.ts";

const taskId = `task-${"a".repeat(64)}-r0001`;
const actorId = "agent/session-001";
const evidence = "b".repeat(64);

function input(events: unknown[], expected: string | null = null) {
  return {
    schema: "tiangong-foundry.interaction-input.v1",
    task_id: taskId,
    actor_id: actorId,
    expected_state_sha256: expected,
    events,
  };
}

const question = {
  kind: "question",
  id: "annual-volume",
  dataset_type: "process",
  missing: "The source does not state whether 12,000 kWh covers the whole year.",
  impact: "The energy per product unit cannot be calculated reliably.",
  recommendation: "Check the original production table first.",
  ask: "What period and production quantity does this electricity value cover?",
  choices: ["I can provide the source table", "I do not know; investigate first"],
  evidence_sha256: [evidence],
  supersedes: null,
};

test("interaction records an exact question and a user answer without converting unknown into consent", () => {
  const first = parseFoundryInteractionInput(input([question]));
  const asked = advanceFoundryInteractionState(
    null,
    first,
    null,
    new Set([evidence]),
    new Set(["process"]),
  );
  assert.equal(asked.events.length, 1);
  assert.equal(asked.events[0]?.kind, "question");
  assert.equal(asked.events[0]?.id, "annual-volume");

  const deferred = parseFoundryInteractionInput(
    input(
      [
        {
          kind: "answer",
          question_id: "annual-volume",
          decision_id: "annual-volume-investigate",
          supersedes_decision_id: null,
          raw_answer: "不清楚，\n请先调查原表。",
          adopted_decision: null,
          disposition: "investigate",
          evidence_sha256: [],
        },
      ],
      "c".repeat(64),
    ),
  );
  const pending = advanceFoundryInteractionState(
    asked,
    deferred,
    "c".repeat(64),
    new Set([evidence]),
    new Set(["process"]),
  );
  assert.equal(pending.events.length, 2);
  assert.equal(pending.events[1]?.raw_answer, "不清楚，\n请先调查原表。");
  assert.equal(pending.events[1]?.adopted_decision, null);

  const answer = parseFoundryInteractionInput(
    input(
      [
        {
          kind: "answer",
          question_id: "annual-volume",
          decision_id: "annual-volume-2025",
          supersedes_decision_id: "annual-volume-investigate",
          raw_answer: "12,000 kWh 是 2025 年全年用电量，产量见附表。",
          adopted_decision:
            "Treat 12,000 kWh as annual electricity for 2025; inspect the supplied production table before deriving a per-unit value.",
          disposition: "decided",
          evidence_sha256: [evidence],
        },
      ],
      "d".repeat(64),
    ),
  );
  const decided = advanceFoundryInteractionState(
    pending,
    answer,
    "d".repeat(64),
    new Set([evidence]),
    new Set(["process"]),
  );
  assert.equal(decided.events.length, 3);
  assert.equal(decided.events[2]?.decision_id, "annual-volume-2025");
  assert.equal(decided.events[1]?.raw_answer, "不清楚，\n请先调查原表。");
});

test("interaction rejects invented evidence, duplicate questions, and stale state", () => {
  const first = parseFoundryInteractionInput(input([question]));
  assert.throws(
    () => advanceFoundryInteractionState(null, first, null, new Set(), new Set(["process"])),
    /evidence/iu,
  );
  const asked = advanceFoundryInteractionState(
    null,
    first,
    null,
    new Set([evidence]),
    new Set(["process"]),
  );
  assert.throws(
    () =>
      advanceFoundryInteractionState(
        asked,
        first,
        "c".repeat(64),
        new Set([evidence]),
        new Set(["process"]),
      ),
    /state|stale/iu,
  );
  const duplicate = parseFoundryInteractionInput(input([question], "c".repeat(64)));
  assert.throws(
    () =>
      advanceFoundryInteractionState(
        asked,
        duplicate,
        "c".repeat(64),
        new Set([evidence]),
        new Set(["process"]),
      ),
    /duplicate/iu,
  );
});

test("support choices reach concrete support rows and corrections require exact predecessor ids", () => {
  const supportQuestion = { ...question, id: "support-method", dataset_type: "support" };
  const asked = advanceFoundryInteractionState(
    null,
    parseFoundryInteractionInput(input([supportQuestion])),
    null,
    new Set([evidence]),
    new Set(["support", "source", "flow"]),
  );
  const decided = advanceFoundryInteractionState(
    asked,
    parseFoundryInteractionInput(
      input(
        [
          {
            kind: "answer",
            question_id: "support-method",
            decision_id: "support-choice",
            supersedes_decision_id: null,
            raw_answer: "Use the documented source.",
            adopted_decision: "Use the registered source evidence.",
            disposition: "decided",
            evidence_sha256: [evidence],
          },
        ],
        "c".repeat(64),
      ),
    ),
    "c".repeat(64),
    new Set([evidence]),
    new Set(["support", "source", "flow"]),
  );
  assert.deepEqual(
    currentFoundryDecisionsForType(decided, "source").map((item) => item.decision_id),
    ["support-choice"],
  );
  assert.deepEqual(currentFoundryDecisionsForType(decided, "flow"), []);
  assert.throws(
    () =>
      advanceFoundryInteractionState(
        decided,
        parseFoundryInteractionInput(
          input(
            [
              {
                kind: "answer",
                question_id: "support-method",
                decision_id: "changed-choice",
                supersedes_decision_id: null,
                raw_answer: "Actually use another source.",
                adopted_decision: "Use another registered source.",
                disposition: "decided",
                evidence_sha256: [evidence],
              },
            ],
            "d".repeat(64),
          ),
        ),
        "d".repeat(64),
        new Set([evidence]),
        new Set(["support", "source", "flow"]),
      ),
    /prior decision/iu,
  );
});

test("AI assumptions cannot replace another scope or fork one predecessor", () => {
  const assumption = {
    kind: "assumption",
    id: "original-process",
    dataset_type: "process",
    statement: "Use the stated process boundary.",
    impact: "Process review changes.",
    evidence_sha256: [],
    supersedes: null,
  };
  const initial = advanceFoundryInteractionState(
    null,
    parseFoundryInteractionInput(input([assumption])),
    null,
    new Set(),
    new Set(["process", "flow"]),
  );
  assert.throws(
    () =>
      advanceFoundryInteractionState(
        initial,
        parseFoundryInteractionInput(
          input(
            [
              {
                ...assumption,
                id: "wrong-flow",
                dataset_type: "flow",
                supersedes: "original-process",
              },
            ],
            "c".repeat(64),
          ),
        ),
        "c".repeat(64),
        new Set(),
        new Set(["process", "flow"]),
      ),
    /same scope/iu,
  );
  assert.throws(
    () =>
      advanceFoundryInteractionState(
        initial,
        parseFoundryInteractionInput(
          input(
            [
              { ...assumption, id: "new-process-a", supersedes: "original-process" },
              { ...assumption, id: "new-process-b", supersedes: "original-process" },
            ],
            "c".repeat(64),
          ),
        ),
        "c".repeat(64),
        new Set(),
        new Set(["process", "flow"]),
      ),
    /current assumption/iu,
  );
});

test("semantic work must cite the current applicable user decision and cannot reuse a replaced choice", () => {
  const asked = advanceFoundryInteractionState(
    null,
    parseFoundryInteractionInput(input([question])),
    null,
    new Set([evidence]),
    new Set(["process", "flow"]),
  );
  const decided = advanceFoundryInteractionState(
    asked,
    parseFoundryInteractionInput(
      input(
        [
          {
            kind: "answer",
            question_id: "annual-volume",
            decision_id: "confirmed-annual",
            supersedes_decision_id: null,
            raw_answer: "全年",
            adopted_decision: "Use annual electricity, subject to source table verification.",
            disposition: "decided",
            evidence_sha256: [evidence],
          },
        ],
        "c".repeat(64),
      ),
    ),
    "c".repeat(64),
    new Set([evidence]),
    new Set(["process", "flow"]),
  );
  const workItem = "e".repeat(64);
  const proposal = (decisionIds?: string[]): FoundrySemanticInput => ({
    schema: "tiangong-foundry.semantic-input.v1",
    task_id: taskId,
    actor_id: actorId,
    assessment_sha256: "f".repeat(64),
    interaction_sha256: "d".repeat(64),
    submissions: [
      {
        kind: "patch",
        authoring_task_sha256: workItem,
        file: "patch.json",
        sha256: "a".repeat(64),
        ...(decisionIds ? { decision_ids: decisionIds } : {}),
      },
    ],
  });
  const current = { sha256: "d".repeat(64), state: decided };
  const processScope = new Map([[workItem, "process"]]);
  assert.throws(
    () => verifyFoundrySemanticInteraction(proposal(), current, processScope),
    /decision ids/iu,
  );
  assert.deepEqual(
    verifyFoundrySemanticInteraction(proposal(["confirmed-annual"]), current, processScope)[0]
      ?.decision_ids,
    ["confirmed-annual"],
  );
  assert.deepEqual(
    verifyFoundrySemanticInteraction(proposal(), current, new Map([[workItem, "flow"]]))[0]
      ?.decision_ids,
    [],
  );
  const corrected = advanceFoundryInteractionState(
    decided,
    parseFoundryInteractionInput(
      input(
        [
          {
            kind: "answer",
            question_id: "annual-volume",
            decision_id: "corrected-period",
            supersedes_decision_id: "confirmed-annual",
            raw_answer: "其实是每吨",
            adopted_decision:
              "Treat the number as per-ton electricity only after checking the original unit.",
            disposition: "decided",
            evidence_sha256: [evidence],
          },
        ],
        "d".repeat(64),
      ),
    ),
    "d".repeat(64),
    new Set([evidence]),
    new Set(["process", "flow"]),
  );
  assert.throws(
    () =>
      verifyFoundrySemanticInteraction(
        proposal(["confirmed-annual"]),
        { sha256: "d".repeat(64), state: corrected },
        processScope,
      ),
    /decision ids/iu,
  );
});

test("public interaction schema accepts the parser's bounded natural-language forms", () => {
  const Ajv = Ajv2020 as unknown as new (options: { strict: boolean }) => {
    compile: (schema: unknown) => (value: unknown) => boolean;
  };
  const schema = JSON.parse(
    fs.readFileSync(
      new URL("../../specs/schemas/foundry-interaction-input.schema.json", import.meta.url),
      "utf8",
    ),
  ) as unknown;
  const validate = new Ajv({ strict: true }).compile(schema);
  assert.equal(validate(input([question])), true);
  assert.equal(
    validate(
      input([
        {
          kind: "answer",
          question_id: "annual-volume",
          decision_id: "investigate",
          supersedes_decision_id: null,
          raw_answer: "不清楚。\n我可以提供原表。",
          adopted_decision: null,
          disposition: "investigate",
          evidence_sha256: [],
        },
      ]),
    ),
    true,
  );
  assert.equal(validate(input([{ ...question, choices: Array(5).fill("too many") }])), false);
  assert.equal(validate(input([{ ...question, missing: "" }])), false);
  assert.equal(validate(input([{ ...question, runtime_manifest: "untrusted" }])), false);
});
