import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";

export type LocationMcpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type LocationMcpClient = {
  tools: LocationMcpTool[];
  callTool(name: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
};

type McpToolResult = {
  isError?: boolean;
  structuredContent?: unknown;
  content: Array<{ type: string; text?: string }>;
};

function parseToolResult(result: McpToolResult): unknown {
  if (result.isError) {
    const message = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text || "")
      .join("\n");
    throw new Error(message || "MCP tool failed");
  }
  if (result.structuredContent !== undefined) return result.structuredContent;

  const text = result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text || "")
    .join("\n");

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function createLocationMcpClient(
  databasePath = process.env.LOCATION_DB_PATH || "data/locations.db",
): Promise<LocationMcpClient> {
  const client = new Client({ name: "dial-drone-backend", version: "1.0.0" });
  const serverPath = fileURLToPath(new URL("./location-mcp-server.ts", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", serverPath],
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    env: { ...getDefaultEnvironment(), LOCATION_DB_PATH: databasePath },
    stderr: "inherit",
  });

  await client.connect(transport);
  const response = await client.listTools();
  const tools = response.tools.map((tool) => ({
    name: tool.name,
    description: tool.description || tool.name,
    inputSchema: tool.inputSchema,
  }));

  return {
    tools,
    async callTool(name, input, signal) {
      const result = await client.callTool(
        { name, arguments: input as Record<string, unknown> },
        undefined,
        { signal },
      );
      return parseToolResult(result as McpToolResult);
    },
    async close() {
      await client.close();
    },
  };
}
