import test from "node:test";
import {
  registeredPreparationCases,
  registeredPreparationGroups,
  verifyRegisteredProcessPreparation,
} from "../helpers/registered-process-preparation.mts";

const selected: readonly string[] = registeredPreparationGroups.targets;
const concurrency = 2;
test("registered Process preparation targets evidence group", { concurrency }, async (t) => {
  await Promise.all(
    registeredPreparationCases
      .filter(([name]) => selected.includes(name))
      .map((entry) =>
        t.test(
          `registered Process preparation consumes actual owner CLI ${entry[0]} annual evidence`,
          async (subtest) => {
            await verifyRegisteredProcessPreparation(subtest, entry);
          },
        ),
      ),
  );
});
