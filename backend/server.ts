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

const port = Number(process.env.PORT || 8080);
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
const signingSecret = process.env.DIAL_SIGNING_SECRET;

if (!signingSecret) throw new Error("DIAL_SIGNING_SECRET is required");

const openai = new OpenAI();
const app = new Hono();

app.get("/", (c) => c.json({ service: "dial-drone-backend", status: "ok" }));
app.get("/health", (c) => c.json({ status: "ok" }));

const defaultPrompt =
  "You are a concise autonomous drone operations assistant on a team phone call. Confirm commands clearly and keep replies short and natural.";

const endCallHint =
  "When the conversation is finished or the caller wants to hang up, call the end_call tool with a brief, natural farewell instead of replying with text.";

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
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
      },
    },
  },
];

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
    { role: "system", content: `${instruction}\n\n${endCallHint}` },
    ...transcript.map((item): OpenAI.Chat.ChatCompletionMessageParam =>
      item.role === "agent"
        ? { role: "assistant", content: item.content }
        : { role: "user", content: item.content },
    ),
  ];
}

function handleCall(ws: WebSocket, callId: string): void {
  console.log(`[${callId}] connected`);

  let inFlight: AbortController | null = null;
  let systemInstruction = defaultPrompt;

  const cancelInFlight = (): void => {
    inFlight?.abort();
    inFlight = null;
  };

  const answer = async (
    responseId: number,
    transcript: TranscriptItem[],
  ): Promise<void> => {
    cancelInFlight();
    const controller = new AbortController();
    inFlight = controller;

    try {
      const stream = await openai.chat.completions.create(
        {
          model,
          messages: toMessages(systemInstruction, transcript),
          stream: true,
          tools,
          tool_choice: "auto",
        },
        { signal: controller.signal },
      );

      let toolName = "";
      let toolArgs = "";

      for await (const chunk of stream) {
        if (controller.signal.aborted) return;

        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          ws.send(
            serializeServerMessage({
              type: "response",
              response_id: responseId,
              content: delta.content,
              content_complete: false,
            }),
          );
        }

        const toolCall = delta?.tool_calls?.[0];
        if (toolCall?.function?.name) toolName = toolCall.function.name;
        if (toolCall?.function?.arguments) toolArgs += toolCall.function.arguments;
      }

      if (controller.signal.aborted) return;

      if (toolName === "end_call") {
        let farewell = "Thanks for calling. Goodbye!";

        try {
          const args: unknown = JSON.parse(toolArgs || "{}");
          if (
            typeof args === "object" &&
            args !== null &&
            "farewell" in args &&
            typeof args.farewell === "string" &&
            args.farewell.trim()
          ) {
            farewell = args.farewell;
          }
        } catch {
          // Keep the default farewell when tool arguments are incomplete.
        }

        ws.send(
          serializeServerMessage({
            type: "response",
            response_id: responseId,
            content: farewell,
            content_complete: true,
            end_call: true,
          }),
        );
        return;
      }

      ws.send(
        serializeServerMessage({
          type: "response",
          response_id: responseId,
          content: "",
          content_complete: true,
        }),
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error(`[${callId}] OpenAI error`, error);
      }
    } finally {
      if (inFlight === controller) inFlight = null;
    }
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
      case "ping_pong":
        ws.send(
          serializeServerMessage({
            type: "ping_pong",
            timestamp: message.timestamp,
          }),
        );
        break;
      case "response_required":
      case "reminder_required":
        void answer(message.response_id, message.transcript);
        break;
    }
  });

  ws.on("close", () => {
    cancelInFlight();
    console.log(`[${callId}] closed`);
  });
}

console.log(`Dial drone backend listening on http://localhost:${port}`);

export default app;
