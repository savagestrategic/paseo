import { expect, test } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  continuationDigest,
  continuationPrefix,
  readContinuationRows,
  stripContinuationPrefix,
} from "./provider-continuation.js";

const id = "11111111-1111-4111-8111-111111111111";
test("archive integrity and row validation precede history use", async () => {
  const dir = await mkdtemp(join(tmpdir(), "continuation-integrity-"));
  try {
    const file = join(dir, "archive.json");
    const contents = JSON.stringify({
      version: 1,
      agentId: id,
      rows: [
        {
          seq: 1,
          timestamp: new Date().toISOString(),
          item: { type: "user_message", text: "Keep edits" },
        },
      ],
    });
    await writeFile(file, contents);
    const digest = continuationDigest(contents);
    expect(await readContinuationRows(file, digest, id)).toHaveLength(1);
    await writeFile(file, contents.replace("Keep edits", "Discard edits"));
    await expect(readContinuationRows(file, digest, id)).rejects.toThrow("transcript changed");
    const malformed = JSON.stringify({
      version: 1,
      agentId: id,
      rows: [{ seq: 1, timestamp: "now", item: { type: "user_message", text: 42 } }],
    });
    await writeFile(file, malformed);
    await expect(readContinuationRows(file, continuationDigest(malformed), id)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("only the exact internal preamble is removed from native user-message history", () => {
  const file = "/private/task archive.json";
  expect(
    stripContinuationPrefix(
      { type: "user_message", text: continuationPrefix(file) + "continue", messageId: "native-id" },
      file,
    ),
  ).toEqual({ type: "user_message", text: "continue", messageId: "native-id" });
  const ordinary = { type: "user_message" as const, text: "Please explain <paseo-continuation>" };
  expect(stripContinuationPrefix(ordinary, file)).toBe(ordinary);
  expect(
    stripContinuationPrefix({ type: "assistant_message", text: continuationPrefix(file) }, file)
      .type,
  ).toBe("assistant_message");
});
