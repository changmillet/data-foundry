import test from "node:test";
import {
  registeredPreparationCases,
  registeredPreparationGroups,
  verifyRegisteredProcessPreparation,
} from "../helpers/registered-process-preparation.mts";

const selected: readonly string[] = registeredPreparationGroups.unresolved;
for (const entry of registeredPreparationCases.filter(([name]) => selected.includes(name))) {
  test(`registered Process preparation consumes actual owner CLI ${entry[0]} annual evidence`, async (t) => {
    await verifyRegisteredProcessPreparation(t, entry);
  });
}
