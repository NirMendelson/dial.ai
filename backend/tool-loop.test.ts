import assert from "node:assert/strict";
import { test } from "node:test";
import type OpenAI from "openai";
import {
  runToolLoop,
  type PendingToolCall,
  type StreamingCompletionClient,
} from "./tool-loop.js";

function streamChunk(
  delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
): OpenAI.Chat.Completions.ChatCompletionChunk {
  return {
    id: "chunk",
    object: "chat.completion.chunk",
    created: 0,
    model: "test",
    choices: [{ index: 0, delta, finish_reason: null, logprobs: null }],
  };
}

function toolStream(id: string, name: string, input: unknown) {
  return [
    streamChunk({
      tool_calls: [
        {
          index: 0,
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(input) },
        },
      ],
    }),
  ];
}

test("runs lookup, calculation, navigation, then returns spoken content", async () => {
  const rounds = [
    toolStream("lookup", "lookup_location", { name: "צ13" }),
    toolStream("calculate", "calculate_position", {
      reference: { latitude: 31.7652, longitude: 35.2134 },
      direction: "northeast",
      distance_meters: 300,
    }),
    toolStream("navigate", "go_to", {
      latitude: 31.7679,
      longitude: 35.2162,
    }),
    [streamChunk({ content: "קיבלתי. בדרך למרחב הסריקה." })],
  ];
  let round = 0;
  const client: StreamingCompletionClient = {
    async create() {
      const chunks = rounds[round++];
      return (async function* () {
        yield* chunks;
      })();
    },
  };
  const executed: string[] = [];

  const result = await runToolLoop({
    client,
    model: "test",
    messages: [{ role: "user", content: "move" }],
    tools: [],
    signal: new AbortController().signal,
    async executeTool(toolCall: PendingToolCall) {
      executed.push(toolCall.name);
      return { output: { ok: true } };
    },
  });

  assert.deepEqual(executed, [
    "lookup_location",
    "calculate_position",
    "go_to",
  ]);
  assert.deepEqual(result, {
    content: "קיבלתי. בדרך למרחב הסריקה.",
    endCall: false,
  });
});

test("stops immediately when a local tool ends the call", async () => {
  const client: StreamingCompletionClient = {
    async create() {
      return (async function* () {
        yield* toolStream("end", "end_call", { farewell: "Goodbye" });
      })();
    },
  };

  const result = await runToolLoop({
    client,
    model: "test",
    messages: [],
    tools: [],
    signal: new AbortController().signal,
    async executeTool() {
      return { output: { ended: true }, endCall: true, content: "Goodbye" };
    },
  });

  assert.deepEqual(result, { content: "Goodbye", endCall: true });
});

test("feeds a failed tool result back to the model", async () => {
  const rounds = [
    toolStream("lookup", "lookup_location", { name: "missing" }),
    [streamChunk({ content: "Location was not found." })],
  ];
  let round = 0;
  const client: StreamingCompletionClient = {
    async create() {
      const chunks = rounds[round++];
      return (async function* () {
        yield* chunks;
      })();
    },
  };

  const result = await runToolLoop({
    client,
    model: "test",
    messages: [],
    tools: [],
    signal: new AbortController().signal,
    async executeTool() {
      return { output: { error: "Location not found" } };
    },
  });

  assert.equal(result.content, "Location was not found.");
  assert.equal(round, 2);
});
