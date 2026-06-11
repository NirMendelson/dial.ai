import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLocationMcpClient } from "./location-mcp-client.js";

test("discovers and executes location MCP tools", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dial-location-mcp-"));
  const client = await createLocationMcpClient(join(directory, "locations.db"));

  try {
    assert.deepEqual(
      client.tools.map((tool) => tool.name),
      ["list_locations", "lookup_location", "calculate_position", "go_to"],
    );

    const lookup = await client.callTool("lookup_location", { name: "צ13" });
    assert.equal(
      (lookup as { location: { latitude: number } }).location.latitude,
      35.268734,
    );

    const navigation = await client.callTool("go_to", {
      latitude: 35.2699,
      longitude: -116.6492,
      label: "scan area",
    });
    assert.deepEqual(navigation, {
      accepted: true,
      latitude: 35.2699,
      longitude: -116.6492,
      label: "scan area",
    });
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
