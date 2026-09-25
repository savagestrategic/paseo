import path from "node:path";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { openModelPicker, searchAllModels } from "../support/helpers/agent-profiles";
import { expectWorkspaceAgentConfiguration } from "../support/helpers/command-center-agent-controls";
import { expectComposerVisible } from "../support/helpers/composer";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test("switching provider keeps the existing agent and its visible history", async ({ page }) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "provider-switch-",
    title: "Provider continuation",
    initialPrompt: "Remember the unfinished provider-switch acceptance task.",
  });
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "provider-switch" });
  try {
    expect((await workspace.client.waitForFinish(workspace.agentId, 30_000)).status).toBe("idle");
    await client.patchDaemonConfig({
      providers: {
        "continuation-fixture": {
          extends: "acp",
          label: "Continuation fixture",
          enabled: true,
          command: [
            process.execPath,
            path.resolve(__dirname, "../support/fixtures/catalog-acp.cjs"),
            "1",
          ],
        },
      },
    });
    await expect
      .poll(
        async () =>
          (await client.getProvidersSnapshot({ cwd: workspace.cwd })).entries.find(
            (entry) => entry.provider === "continuation-fixture",
          )?.status,
        { timeout: 30_000 },
      )
      .toBe("ready");
    await openAgentRoute(page, workspace);
    await expectComposerVisible(page);
    const route = page.url();
    const oldPrompt = page.getByText("Remember the unfinished provider-switch acceptance task.", {
      exact: true,
    });
    await expect(oldPrompt).toBeVisible();
    await openModelPicker(page);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await searchAllModels(page, "Gemini 3.5 Flash");
    await page.getByTestId("model-row-continuation-fixture-gemini-3.5-flash").click();
    await expectWorkspaceAgentConfiguration(workspace, {
      id: workspace.agentId,
      provider: "continuation-fixture",
      model: "gemini-3.5-flash",
      modeId: null,
    });
    await expect(page).toHaveURL(route);
    await expect(oldPrompt).toBeVisible();
    const switched = (await client.fetchAgent({ agentId: workspace.agentId }))?.agent;
    expect(switched?.cwd).toBe(workspace.cwd);
    expect(switched?.workspaceId).toBe(workspace.workspaceId);
    expect(switched?.status).toBe("idle");
    await page.reload();
    await expectComposerVisible(page);
    await expect(oldPrompt).toBeVisible();
    await expect(page.getByTestId("combined-model-selector").first()).toContainText(
      "Gemini 3.5 Flash",
    );
  } finally {
    await workspace.cleanup();
    await client.patchDaemonConfig({ removeProviders: ["continuation-fixture"] });
    await client.close();
  }
});
