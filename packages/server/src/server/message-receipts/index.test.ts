import { mkdir, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { MessageReceipts } from "./index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-requests-"));
  directories.push(directory);
  return { directory, requests: new MessageReceipts(directory) };
}

test("message retries survive reconstruction without submitting twice", async () => {
  const { requests, directory } = await fixture();
  let deliveries = 0;
  const input = {
    agentId: "agent",
    messageId: "arrival",
    request: { text: "hello" },
    send: async () => {
      deliveries++;
    },
  };
  await Promise.all([requests.send(input), requests.send(input)]);
  await new MessageReceipts(directory).send(input);
  expect(deliveries).toBe(1);
  await requests.send({ ...input, agentId: "another" });
  expect(deliveries).toBe(2);
});

test("ambiguous provider delivery is never blindly replayed after restart", async () => {
  const { requests, directory } = await fixture();
  let deliveries = 0;
  const input = {
    agentId: "agent",
    messageId: "arrival",
    request: {},
    send: async () => {
      deliveries++;
      throw new Error("connection lost");
    },
  };
  await expect(requests.send(input)).rejects.toThrow("connection lost");
  await expect(new MessageReceipts(directory).send(input)).rejects.toThrow(
    "agent_request_outcome_unknown",
  );
  expect(deliveries).toBe(1);
});

test("failed local message preparation does not leave an ambiguous receipt", async () => {
  const { requests, directory } = await fixture();
  let available = false;
  let sends = 0;
  const input = {
    agentId: "agent",
    messageId: "message",
    request: {},
    prepare: async () => {
      if (!available) throw new Error("load failed");
    },
    send: async () => {
      sends++;
    },
  };
  await expect(requests.send(input)).rejects.toThrow("load failed");
  available = true;
  await new MessageReceipts(directory).send(input);
  available = false;
  await requests.send(input);
  expect(sends).toBe(1);
});

test("conditional admission keeps one accepted result across concurrent retries and reconstruction", async () => {
  const { requests, directory } = await fixture();
  let admissions = 0;
  const input = {
    agentId: "agent",
    messageId: "conditional-arrival",
    request: { text: "Review owned work" },
    admit: async () => {
      admissions++;
      return { status: "accepted" as const, turnId: "turn-1" };
    },
  };
  expect(await Promise.all([requests.admit(input), requests.admit(input)])).toEqual([
    { status: "accepted", turnId: "turn-1" },
    { status: "accepted", turnId: "turn-1" },
  ]);
  expect(await new MessageReceipts(directory).admit(input)).toEqual({
    status: "accepted",
    turnId: "turn-1",
  });
  expect(admissions).toBe(1);
});

test("conditional uncertainty survives restart without another provider attempt", async () => {
  const { requests, directory } = await fixture();
  let calls = 0;
  const input = {
    agentId: "recipient",
    messageId: "uncertain",
    request: { text: "owned task" },
    admit: async () => {
      calls++;
      throw new Error("Provider may have accepted before disconnect");
    },
  };
  expect(await requests.admit(input)).toEqual({ status: "outcome_unknown" });
  expect(await new MessageReceipts(directory).admit(input)).toEqual({ status: "outcome_unknown" });
  expect(calls).toBe(1);
});

test("conditional changed payload conflicts and a refusal does not become an eventual send", async () => {
  const { requests } = await fixture();
  let calls = 0;
  const input = {
    agentId: "recipient",
    messageId: "bounded",
    request: { text: "first" },
    admit: async () => {
      calls++;
      return { status: "rejected" as const, reason: "busy" as const };
    },
  };
  expect(await requests.admit(input)).toEqual({ status: "rejected", reason: "busy" });
  expect(await requests.admit({ ...input, request: { text: "changed" } })).toEqual({
    status: "rejected",
    reason: "message_id_conflict",
  });
  expect(await requests.admit(input)).toEqual({ status: "rejected", reason: "busy" });
  expect(calls).toBe(1);
});

test("reload persists uncertainty before effects and reuses one result across retries", async () => {
  const { requests, directory } = await fixture();
  let reloads = 0;
  const input = {
    agentId: "worker",
    operationId: "escalation",
    request: { expectedNativeTurnId: "luna-turn", model: "gpt-6.1-sol" },
    reload: async () => {
      reloads++;
      const files = await readdir(directory);
      expect(files).toHaveLength(1);
      expect(JSON.parse(await readFile(path.join(directory, files[0]!), "utf8"))).toMatchObject({
        state: "pending",
        agentId: "worker",
      });
      // A reconstructed connection cannot replay an operation still in flight.
      expect(await new MessageReceipts(directory).reload(input)).toEqual({
        status: "outcome_unknown",
      });
      return { status: "reloaded" as const, sessionId: "same-native-worker" };
    },
  };
  const expected = { status: "reloaded", sessionId: "same-native-worker" };
  expect(await Promise.all([requests.reload(input), requests.reload(input)])).toEqual([
    expected,
    expected,
  ]);
  expect(await new MessageReceipts(directory).reload(input)).toEqual(expected);
  expect(reloads).toBe(1);
});

test("reload scope conflicts and refusals stay terminal after reconstruction", async () => {
  const { requests, directory } = await fixture();
  let reloads = 0;
  const input = {
    agentId: "worker",
    operationId: "escalation",
    request: { model: "gpt-6.1-sol" },
    reload: async () => {
      reloads++;
      return { status: "rejected" as const, reason: "busy" as const };
    },
  };
  expect(await requests.reload(input)).toEqual({ status: "rejected", reason: "busy" });
  const restarted = new MessageReceipts(directory);
  expect(await restarted.reload({ ...input, request: { model: "other" } })).toEqual({
    status: "rejected",
    reason: "operation_id_conflict",
  });
  expect(await restarted.reload(input)).toEqual({ status: "rejected", reason: "busy" });
  expect(reloads).toBe(1);
});

test.each(["provider", "invalid_result", "receipt_failure"])(
  "reload %s uncertainty survives restart without repeating effects",
  async (scenario) => {
    const { requests, directory } = await fixture();
    let reloads = 0;
    const input = {
      agentId: "worker",
      operationId: "uncertain",
      request: {},
      reload: async () => {
        reloads++;
        if (scenario === "provider") throw new Error("Close may have completed");
        if (scenario === "invalid_result") return { status: "reloaded" as const, sessionId: "" };
        // Make the atomic acceptance write fail after the provider effect,
        // retaining the original pending receipt for inspection.
        const file = (await readdir(directory))[0]!;
        await rename(path.join(directory, file), path.join(directory, `${file}.retained`));
        await mkdir(path.join(directory, file));
        return { status: "reloaded" as const, sessionId: "native" };
      },
    };
    expect(await requests.reload(input)).toEqual({ status: "outcome_unknown" });
    if (scenario === "receipt_failure") {
      await expect(new MessageReceipts(directory).reload(input)).rejects.toThrow();
    } else {
      expect(await new MessageReceipts(directory).reload(input)).toEqual({
        status: "outcome_unknown",
      });
    }
    expect(reloads).toBe(1);
  },
);

test("reload receipt scope is captured before caller mutation", async () => {
  const { requests } = await fixture();
  const original = { model: "gpt-6.1-sol" };
  const input = {
    agentId: "worker",
    operationId: "captured",
    request: { ...original },
    reload: async () => ({ status: "reloaded" as const, sessionId: "native" }),
  };
  const pending = requests.reload(input);
  input.request.model = "changed";
  await pending;
  expect(await requests.reload({ ...input, request: original })).toEqual({
    status: "reloaded",
    sessionId: "native",
  });
  expect(await requests.reload(input)).toEqual({
    status: "rejected",
    reason: "operation_id_conflict",
  });
});

test("reload and message admission retain separate durable operation identities", async () => {
  const { requests, directory } = await fixture();
  let reloads = 0;
  let messages = 0;
  const reload = {
    agentId: "worker",
    operationId: "same-id",
    request: { first: 1, second: 2 },
    reload: async () => {
      reloads++;
      return { status: "reloaded" as const, sessionId: "native" };
    },
  };
  const message = {
    agentId: "worker",
    messageId: "same-id",
    request: { first: 1, second: 2 },
    admit: async () => {
      messages++;
      return { status: "accepted" as const, turnId: "next-turn" };
    },
  };
  await Promise.all([requests.reload(reload), requests.admit(message)]);
  const restarted = new MessageReceipts(directory);
  expect(await restarted.reload({ ...reload, request: { second: 2, first: 1 } })).toEqual({
    status: "reloaded",
    sessionId: "native",
  });
  expect(await restarted.admit(message)).toEqual({ status: "accepted", turnId: "next-turn" });
  expect({ reloads, messages }).toEqual({ reloads: 1, messages: 1 });
});
