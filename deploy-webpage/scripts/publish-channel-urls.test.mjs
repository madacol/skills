import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  invokeRuntimeAction,
  mergeChannelDescriptionUrls,
  publishChannelUrls,
} from "./publish-channel-urls.mjs";

test("channel URL merge preserves existing text and uses exact full-line matches", () => {
  const current = "Release links\r\nhttps://app.example/path-extra\nQuoted \\\"text\\\"\n";

  assert.deepEqual(mergeChannelDescriptionUrls(current, [
    "https://app.example/path",
    "https://app.example/path-extra",
    "https://app.example/path",
  ]), {
    description: `${current}https://app.example/path`,
    added: ["https://app.example/path"],
  });
});

test("channel URL publication reads, merges, and writes the structured description", async () => {
  /** @type {{method: string, params: unknown}[]} */
  const calls = [];
  const result = await publishChannelUrls([
    "https://private.example.test",
    "https://public.example.test/?token=a\\\"b",
  ], {
    invoke: async (method, params) => {
      calls.push({ method, params });
      return method === "get_current_channel_description"
        ? { description: "Existing \\\"release\\\" links" }
        : {
            status: "updated",
            description: "Existing \\\"release\\\" links\nhttps://private.example.test\nhttps://public.example.test/?token=a\\\"b",
          };
    },
  });

  assert.deepEqual(calls, [
    { method: "get_current_channel_description", params: null },
    {
      method: "set_current_channel_description",
      params: {
        description: "Existing \\\"release\\\" links\nhttps://private.example.test\nhttps://public.example.test/?token=a\\\"b",
      },
    },
  ]);
  assert.deepEqual(result.added, [
    "https://private.example.test",
    "https://public.example.test/?token=a\\\"b",
  ]);
});

test("channel URL publication skips the setter when every exact URL line exists", async () => {
  let setCalls = 0;
  const current = "Links\nhttps://app.example.test\nhttps://docs.example.test";
  const result = await publishChannelUrls([
    "https://docs.example.test",
    "https://app.example.test",
  ], {
    invoke: async (method) => {
      if (method === "get_current_channel_description") return { description: current };
      setCalls += 1;
      return { status: "updated" };
    },
  });

  assert.equal(setCalls, 0);
  assert.deepEqual(result, { status: "unchanged", description: current, added: [] });
});

test("channel URL publication rejects an incoherent setter result", async () => {
  await assert.rejects(
    publishChannelUrls(["https://app.example.test"], {
      invoke: async (method) => method === "get_current_channel_description"
        ? { description: "Existing links" }
        : { status: "updated", description: "Different text" },
    }),
    /setter returned an invalid result/,
  );
});

test("channel URL publication rejects non-HTTP URLs", async () => {
  await assert.rejects(
    publishChannelUrls(["file:///tmp/private.html"], {
      invoke: async () => ({ description: null }),
    }),
    /HTTP or HTTPS URL/,
  );
});

test("publisher reads JSON from the invocation CLI when launched by Node", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "deploy-webpage-publisher-test-"));
  const rpcScript = path.join(directory, "fake-rpc.mjs");
  await writeFile(rpcScript, [
    "#!/usr/bin/env node",
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "for await (const chunk of process.stdin) input += chunk;",
    "process.stdout.write(JSON.stringify({ params: JSON.parse(input) }) + '\\n');",
    "",
  ].join("\n"));
  await chmod(rpcScript, 0o700);

  const previousScript = process.env.MADABOT_INVOCATION_RPC_SCRIPT;
  process.env.MADABOT_INVOCATION_RPC_SCRIPT = rpcScript;
  try {
    assert.deepEqual(
      await invokeRuntimeAction("set_current_channel_description", { description: "Release links" }),
      { params: { description: "Release links" } },
    );
  } finally {
    if (previousScript === undefined) {
      delete process.env.MADABOT_INVOCATION_RPC_SCRIPT;
    } else {
      process.env.MADABOT_INVOCATION_RPC_SCRIPT = previousScript;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
