import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { LocationStore } from "./location-store.js";
import { calculatePosition, directions } from "./position.js";

const databasePath = process.env.LOCATION_DB_PATH || "data/locations.db";
const store = new LocationStore(databasePath);
const server = new McpServer({ name: "dial-location-tools", version: "1.0.0" });

const locationSchema = z.object({
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  description: z.string(),
});

server.registerTool(
  "list_locations",
  {
    description: "List all named mission locations and their coordinates.",
    inputSchema: {},
    outputSchema: { locations: z.array(locationSchema) },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => {
    const result = { locations: store.list() };
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "lookup_location",
  {
    description: "Look up one named mission location in the location database.",
    inputSchema: { name: z.string().trim().min(1) },
    outputSchema: { location: locationSchema },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ name }) => {
    const result = { location: store.lookup(name) };
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "calculate_position",
  {
    description:
      "Calculate coordinates a distance and compass direction from reference coordinates.",
    inputSchema: {
      reference: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
      direction: z.enum(directions),
      distance_meters: z.number().positive(),
    },
    outputSchema: { latitude: z.number(), longitude: z.number() },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ reference, direction, distance_meters }) => {
    const result = calculatePosition(reference, direction, distance_meters);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "go_to",
  {
    description:
      "Command the demo drone to navigate to validated latitude and longitude coordinates.",
    inputSchema: {
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      label: z.string().trim().min(1).optional(),
    },
    outputSchema: {
      accepted: z.boolean(),
      latitude: z.number(),
      longitude: z.number(),
      label: z.string().optional(),
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  async ({ latitude, longitude, label }) => {
    const result = { accepted: true, latitude, longitude, ...(label ? { label } : {}) };
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = async (): Promise<void> => {
  store.close();
  await server.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

