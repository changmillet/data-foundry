import test from "node:test";
import { verifyInstalledPreparationGroup } from "../helpers/installed-preparation-group.mts";

test("source-free installed managed Process preparation unresolved group", async (t) => {
  await verifyInstalledPreparationGroup(t, "unresolved");
});
