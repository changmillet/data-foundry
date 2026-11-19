import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  verifyGuardedUpdate,
  type ScientificRepairQaConfiguration,
} from "../fixtures/guarded-process-repair.ts";

const configuration = process.env.TIANGONG_FOUNDRY_SCIENTIFIC_REPAIR_QA_CONFIG;
test(
  "deployed native Worker and TIDAS qualify a scientific owner-draft revision and recover its single original write",
  {
    skip:
      !configuration &&
      "requires an explicit TIANGONG_FOUNDRY_SCIENTIFIC_REPAIR_QA_CONFIG deployment selection",
  },
  async (t) => {
    if (!configuration || !path.isAbsolute(configuration))
      throw new Error("Native scientific QA requires an absolute deployment configuration path.");
    const selected = JSON.parse(
      fs.readFileSync(configuration, "utf8"),
    ) as ScientificRepairQaConfiguration;
    await verifyGuardedUpdate(t, true, "update", selected);
  },
);
