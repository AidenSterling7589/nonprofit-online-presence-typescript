import test from "node:test";
import assert from "node:assert/strict";
import { chooseReminder, type WorkspaceRequest } from "./presence_service.ts";

const request: WorkspaceRequest = {
  workspace: "harbor-house",
  donorReceipt: { donor: "donor-17", amount: 125 },
  volunteerReminder: { volunteer: "volunteer-4", message: "Confirm the pantry shift." },
  campaignReport: { campaign: "winter-pantry", raised: 4200 }
};

test("only an online named volunteer receives the reminder decision", () => {
  assert.equal(chooseReminder({ identity: "volunteer-4", display_name: "Mina" }, request), "Confirm the pantry shift.");
  assert.equal(chooseReminder({ identity: "donor-17" }, request), null);
});
