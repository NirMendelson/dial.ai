import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import {
  parseDialMessage,
  serializeServerMessage,
  verifyDialSignature,
  type DialServerMessage,
  type TranscriptItem,
} from "@getdial/sdk";
import { Hono } from "hono";
import OpenAI from "openai";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import {
  createLocationMcpClient,
  type LocationMcpClient,
} from "./location-mcp-client.js";
import type { Location } from "./location-store.js";
import {
  runToolLoop,
  type PendingToolCall,
  type StreamingCompletionClient,
  type ToolExecutionResult,
} from "./tool-loop.js";
import { containsWakeName, getLatestUserTurn } from "./wake-trigger.js";

const port = Number(process.env.PORT || 8080);
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
const signingSecret = process.env.DIAL_SIGNING_SECRET;
const wakeName = process.env.AGENT_WAKE_NAME?.trim() || "ברק 1";

if (!signingSecret) throw new Error("DIAL_SIGNING_SECRET is required");

const openai = new OpenAI();
const locationMcp = await createLocationMcpClient();
const app = new Hono();

type TranscriptStatus = "waiting" | "connected" | "ended";

export type StatusActivity = {
  id: string;
  type: "status";
  phase: "processing" | "responding";
  status: "running" | "completed" | "cancelled";
  timestamp: string;
  transcriptIndex: number;
};

export type ToolActivity = {
  id: string;
  type: "tool";
  name: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  input: unknown;
  output?: unknown;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  transcriptIndex: number;
};

export type AgentActivity = StatusActivity | ToolActivity;

type TranscriptState = {
  callId: string | null;
  status: TranscriptStatus;
  transcript: TranscriptItem[];
  agentDraft: string;
  activities: AgentActivity[];
  locations: Location[];
};

function readLocations(result: unknown): Location[] {
  if (
    typeof result !== "object" ||
    result === null ||
    !("locations" in result) ||
    !Array.isArray(result.locations)
  ) {
    throw new Error("list_locations returned an invalid result");
  }
  return result.locations as Location[];
}

const locations = readLocations(await locationMcp.callTool("list_locations", {}));
let transcriptState: TranscriptState = {
  callId: null,
  status: "waiting",
  transcript: [],
  agentDraft: "",
  activities: [],
  locations,
};

const transcriptSubscribers = new Map<
  ReadableStreamDefaultController<Uint8Array>,
  ReturnType<typeof setInterval>
>();
const textEncoder = new TextEncoder();

function encodeSseState(): Uint8Array {
  return textEncoder.encode(
    `event: state\ndata: ${JSON.stringify(transcriptState)}\n\n`,
  );
}

function broadcastTranscriptState(): void {
  const message = encodeSseState();

  for (const [subscriber, heartbeat] of transcriptSubscribers) {
    try {
      subscriber.enqueue(message);
    } catch {
      clearInterval(heartbeat);
      transcriptSubscribers.delete(subscriber);
    }
  }
}

function appendActivity(callId: string, activity: AgentActivity): void {
  if (transcriptState.callId !== callId) return;
  transcriptState = {
    ...transcriptState,
    activities: [...transcriptState.activities, activity].slice(-50),
  };
  broadcastTranscriptState();
}

function replaceActivity(
  callId: string,
  activityId: string,
  update: (activity: AgentActivity) => AgentActivity,
): void {
  if (transcriptState.callId !== callId) return;
  transcriptState = {
    ...transcriptState,
    activities: transcriptState.activities.map((activity) =>
      activity.id === activityId ? update(activity) : activity,
    ),
  };
  broadcastTranscriptState();
}

function startStatusActivity(
  callId: string,
  phase: StatusActivity["phase"],
): string {
  const id = randomUUID();
  appendActivity(callId, {
    id,
    type: "status",
    phase,
    status: "running",
    timestamp: new Date().toISOString(),
    transcriptIndex: transcriptState.transcript.length,
  });
  return id;
}

function finishStatusActivity(
  callId: string,
  activityId: string,
  status: "completed" | "cancelled",
): void {
  replaceActivity(callId, activityId, (activity) =>
    activity.type === "status" ? { ...activity, status } : activity,
  );
}

function cancelRunningActivities(callId: string): void {
  if (transcriptState.callId !== callId) return;
  const finishedAt = new Date().toISOString();
  let changed = false;
  const activities = transcriptState.activities.map((activity): AgentActivity => {
    if (activity.status !== "running") return activity;
    changed = true;
    return activity.type === "status"
      ? { ...activity, status: "cancelled" }
      : { ...activity, status: "cancelled", finishedAt };
  });

  if (!changed) return;
  transcriptState = { ...transcriptState, activities };
  broadcastTranscriptState();
}

function draftAppearsInTranscript(
  transcript: TranscriptItem[],
  draft: string,
): boolean {
  const normalizedDraft = draft.trim();
  if (!normalizedDraft) return false;

  const latestItem = transcript[transcript.length - 1];
  if (latestItem?.role !== "agent") return false;

  const normalizedContent = latestItem.content.trim();
  return (
    normalizedContent.length > 0 &&
    (normalizedContent.includes(normalizedDraft) ||
      normalizedDraft.includes(normalizedContent))
  );
}

function publishTranscript(
  callId: string,
  transcript: TranscriptItem[],
): void {
  if (transcriptState.callId !== callId) return;

  transcriptState = {
    ...transcriptState,
    transcript,
    agentDraft: draftAppearsInTranscript(
      transcript,
      transcriptState.agentDraft,
    )
      ? ""
      : transcriptState.agentDraft,
  };
  broadcastTranscriptState();
}

app.get("/", (c) => c.json({ service: "dial-drone-backend", status: "ok" }));
app.get("/health", (c) => c.json({ status: "ok" }));
app.get("/api/transcript", (c) => c.json(transcriptState));
app.get("/api/transcript/stream", (c) => {
  let subscriber: ReadableStreamDefaultController<Uint8Array> | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      subscriber = controller;
      controller.enqueue(encodeSseState());
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(textEncoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(heartbeat);
          transcriptSubscribers.delete(controller);
        }
      }, 15_000);
      transcriptSubscribers.set(controller, heartbeat);
    },
    cancel() {
      if (!subscriber) return;

      const heartbeat = transcriptSubscribers.get(subscriber);
      if (heartbeat) clearInterval(heartbeat);
      transcriptSubscribers.delete(subscriber);
    },
  });

  return c.body(body, 200, {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
});

const defaultPrompt =
  `You are ${wakeName}, a concise autonomous drone operations assistant on a team phone call. Confirm commands clearly, reply in the caller's language, and keep replies short and natural.`;

const toolHint =
  "Use the location tools when a command depends on a named place or relative position. Look locations up before calculating coordinates, and call go_to only after the destination is resolved.";

const endCallHint =
  "When the conversation is finished or the caller wants to hang up, call the end_call tool with a brief, natural farewell instead of replying with text.";

const endCallTool: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "end_call",
    description: "End the phone call when the task or conversation is complete.",
    parameters: {
      type: "object",
      properties: {
        farewell: {
          type: "string",
          description: "A short, natural goodbye to say before hanging up.",
        },
      },
      required: ["farewell"],
      additionalProperties: false,
    },
  },
};

const mcpTools: OpenAI.Chat.ChatCompletionTool[] = locationMcp.tools.map(
  (tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }),
);
const tools = [endCallTool, ...mcpTools];
const mcpToolNames = new Set(locationMcp.tools.map((tool) => tool.name));
const endCallArguments = z.object({ farewell: z.string().trim().min(1) });

const server = serve({ fetch: app.fetch, port });
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "", "http://localhost");
  const callId = url.pathname.split("/").filter(Boolean).pop();
  const signature = request.headers["x-dial-signature"];

  if (
    !callId ||
    !signature ||
    !verifyDialSignature(signingSecret, String(signature), callId)
  ) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => handleCall(ws, callId));
});

function toMessages(
  instruction: string,
  transcript: TranscriptItem[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content: `${instruction}\n\n${toolHint}\n\n${endCallHint}`,
    },
    ...transcript.map((item): OpenAI.Chat.ChatCompletionMessageParam =>
      item.role === "agent"
        ? { role: "assistant", content: item.content }
        : { role: "user", content: item.content },
    ),
  ];
}

function parseToolInput(rawArguments: string): unknown {
  return JSON.parse(rawArguments || "{}");
}

function handleCall(ws: WebSocket, callId: string): void {
  console.log(`[${callId}] connected`);

  if (transcriptState.callId !== callId) {
    transcriptState = {
      callId,
      status: "connected",
      transcript: [],
      agentDraft: "",
      activities: [],
      locations,
    };
  } else {
    transcriptState = { ...transcriptState, status: "connected" };
  }
  broadcastTranscriptState();

  let inFlight: AbortController | null = null;
  let systemInstruction = defaultPrompt;

  const cancelInFlight = (): void => {
    if (!inFlight) return;
    inFlight.abort();
    inFlight = null;
    cancelRunningActivities(callId);
  };

  const executeTool = async (
    toolCall: PendingToolCall,
    signal: AbortSignal,
  ): Promise<ToolExecutionResult> => {
    const activityId = toolCall.id || randomUUID();
    const startedAt = new Date().toISOString();
    let input: unknown;

    try {
      input = parseToolInput(toolCall.arguments);
    } catch {
      const error = "Tool arguments were not valid JSON";
      appendActivity(callId, {
        id: activityId,
        type: "tool",
        name: toolCall.name || "unknown",
        status: "failed",
        input: { raw: toolCall.arguments },
        error,
        startedAt,
        finishedAt: new Date().toISOString(),
        transcriptIndex: transcriptState.transcript.length,
      });
      return { output: { error } };
    }

    appendActivity(callId, {
      id: activityId,
      type: "tool",
      name: toolCall.name,
      status: "running",
      input,
      startedAt,
      transcriptIndex: transcriptState.transcript.length,
    });

    try {
      signal.throwIfAborted();
      let result: ToolExecutionResult;

      if (toolCall.name === "end_call") {
        const args = endCallArguments.parse(input);
        result = {
          output: { ended: true },
          endCall: true,
          content: args.farewell,
        };
      } else {
        if (!mcpToolNames.has(toolCall.name)) {
          throw new Error(`Unknown tool: ${toolCall.name}`);
        }
        result = {
          output: await locationMcp.callTool(toolCall.name, input, signal),
        };
      }

      replaceActivity(callId, activityId, (activity) =>
        activity.type === "tool"
          ? {
              ...activity,
              status: "succeeded",
              output: result.output,
              finishedAt: new Date().toISOString(),
            }
          : activity,
      );
      return result;
    } catch (error) {
      if (signal.aborted) {
        replaceActivity(callId, activityId, (activity) =>
          activity.type === "tool"
            ? {
                ...activity,
                status: "cancelled",
                finishedAt: new Date().toISOString(),
              }
            : activity,
        );
        signal.throwIfAborted();
      }

      const message = error instanceof Error ? error.message : "Tool failed";
      replaceActivity(callId, activityId, (activity) =>
        activity.type === "tool"
          ? {
              ...activity,
              status: "failed",
              error: message,
              finishedAt: new Date().toISOString(),
            }
          : activity,
      );
      return { output: { error: message } };
    }
  };

  const answer = async (
    responseId: number,
    transcript: TranscriptItem[],
  ): Promise<void> => {
    cancelInFlight();
    publishTranscript(callId, transcript);

    if (transcriptState.callId === callId) {
      transcriptState = { ...transcriptState, agentDraft: "" };
      broadcastTranscriptState();
    }

    const controller = new AbortController();
    inFlight = controller;
    const processingId = startStatusActivity(callId, "processing");

    try {
      const result = await runToolLoop({
        client: openai.chat.completions as StreamingCompletionClient,
        model,
        messages: toMessages(systemInstruction, transcript),
        tools,
        signal: controller.signal,
        executeTool,
        onDraft(content) {
          if (transcriptState.callId !== callId) return;
          transcriptState = { ...transcriptState, agentDraft: content };
          broadcastTranscriptState();
        },
      });

      finishStatusActivity(callId, processingId, "completed");
      const respondingId = startStatusActivity(callId, "responding");
      if (transcriptState.callId === callId) {
        transcriptState = { ...transcriptState, agentDraft: result.content };
        broadcastTranscriptState();
      }

      ws.send(
        serializeServerMessage({
          type: "response",
          response_id: responseId,
          content: result.content,
          content_complete: true,
          ...(result.endCall ? { end_call: true } : {}),
        }),
      );
      finishStatusActivity(callId, respondingId, "completed");
    } catch (error) {
      if (controller.signal.aborted) return;

      console.error(`[${callId}] agent error`, error);
      finishStatusActivity(callId, processingId, "completed");
      const respondingId = startStatusActivity(callId, "responding");
      const fallback = "לא הצלחתי להשלים את הפקודה.";
      if (transcriptState.callId === callId) {
        transcriptState = { ...transcriptState, agentDraft: fallback };
        broadcastTranscriptState();
      }
      ws.send(
        serializeServerMessage({
          type: "response",
          response_id: responseId,
          content: fallback,
          content_complete: true,
        }),
      );
      finishStatusActivity(callId, respondingId, "completed");
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  };

  const answerSilently = (
    responseId: number,
    transcript: TranscriptItem[],
  ): void => {
    cancelInFlight();
    publishTranscript(callId, transcript);

    if (transcriptState.callId === callId && transcriptState.agentDraft) {
      transcriptState = { ...transcriptState, agentDraft: "" };
      broadcastTranscriptState();
    }

    ws.send(
      serializeServerMessage({
        type: "response",
        response_id: responseId,
        content: "",
        content_complete: true,
      }),
    );
  };

  ws.on("message", (raw) => {
    let message: DialServerMessage;

    try {
      message = parseDialMessage(raw.toString());
    } catch {
      return;
    }

    console.log(`[${callId}] <- ${message.type}`);

    switch (message.type) {
      case "call_connected":
        if (message.instruction) systemInstruction = message.instruction;
        break;
      case "transcript_update":
        publishTranscript(callId, message.transcript);
        break;
      case "ping_pong":
        ws.send(
          serializeServerMessage({
            type: "ping_pong",
            timestamp: message.timestamp,
          }),
        );
        break;
      case "response_required": {
        const latestUserTurn = getLatestUserTurn(message.transcript);

        if (
          !latestUserTurn ||
          !containsWakeName(latestUserTurn.content, wakeName)
        ) {
          answerSilently(message.response_id, message.transcript);
          break;
        }

        console.log(`[${callId}] wake name detected: ${wakeName}`);
        void answer(message.response_id, message.transcript);
        break;
      }
      case "reminder_required":
        answerSilently(message.response_id, message.transcript);
        break;
    }
  });

  ws.on("close", () => {
    cancelInFlight();
    if (transcriptState.callId === callId) {
      transcriptState = { ...transcriptState, status: "ended" };
      broadcastTranscriptState();
    }
    console.log(`[${callId}] closed`);
  });
}

console.log(
  `Dial drone backend listening on http://localhost:${port} with ${locationMcp.tools.length} MCP tools`,
);

export default app;
