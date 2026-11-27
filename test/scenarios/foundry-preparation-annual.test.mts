import test from "node:test";
import {
  registeredPreparationCases,
  registeredPreparationGroups,
  verifyRegisteredProcessPreparation,
} from "../helpers/registered-process-preparation.mts";

const selected: readonly string[] = registeredPreparationGroups.annual;
const concurrency = process.platform === "win32" ? 2 : 4;
test("registered Process preparation annual evidence group", { concurrency }, async (t) => {
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
