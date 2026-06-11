import type OpenAI from "openai";

type CompletionStream = AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

export type StreamingCompletionClient = {
  create(
    params: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    options?: { signal?: AbortSignal },
  ): Promise<CompletionStream>;
};

export type PendingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ToolExecutionResult = {
  output: unknown;
  endCall?: boolean;
  content?: string;
};

type RunToolLoopOptions = {
  client: StreamingCompletionClient;
  model: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools: OpenAI.Chat.ChatCompletionTool[];
  signal: AbortSignal;
  executeTool(
    toolCall: PendingToolCall,
    signal: AbortSignal,
  ): Promise<ToolExecutionResult>;
  onDraft?(content: string): void;
  maxRounds?: number;
};

export type ToolLoopResult = {
  content: string;
  endCall: boolean;
};

export async function runToolLoop({
  client,
  model,
  messages: initialMessages,
  tools,
  signal,
  executeTool,
  onDraft,
  maxRounds = 6,
}: RunToolLoopOptions): Promise<ToolLoopResult> {
  const messages = [...initialMessages];

  for (let round = 0; round < maxRounds; round += 1) {
    signal.throwIfAborted();
    onDraft?.("");

    const stream = await client.create(
      { model, messages, stream: true, tools, tool_choice: "auto" },
      { signal },
    );
    let content = "";
    const pendingCalls = new Map<number, PendingToolCall>();

    for await (const chunk of stream) {
      signal.throwIfAborted();
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        content += delta.content;
        onDraft?.(content);
      }

      for (const toolCall of delta?.tool_calls || []) {
        const pending = pendingCalls.get(toolCall.index) || {
          id: toolCall.id || `tool-${round}-${toolCall.index}`,
          name: "",
          arguments: "",
        };
        if (toolCall.id) pending.id = toolCall.id;
        if (toolCall.function?.name) pending.name += toolCall.function.name;
        if (toolCall.function?.arguments) {
          pending.arguments += toolCall.function.arguments;
        }
        pendingCalls.set(toolCall.index, pending);
      }
    }

    signal.throwIfAborted();
    const toolCalls = [...pendingCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => call);

    if (toolCalls.length === 0) return { content, endCall: false };

    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: { name: toolCall.name, arguments: toolCall.arguments },
      })),
    });

    for (const toolCall of toolCalls) {
      const result = await executeTool(toolCall, signal);
      if (result.endCall) {
        return { content: result.content || "", endCall: true };
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result.output),
      });
    }
  }

  throw new Error(`Tool loop exceeded ${maxRounds} model rounds`);
}

