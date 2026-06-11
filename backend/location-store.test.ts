import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { LocationStore } from "./location-store.js";

test("seeds locations idempotently and looks them up", () => {
  const store = new LocationStore(":memory:");

  assert.equal(store.list().length, 5);
  assert.deepEqual(store.lookup("צ13"), {
    name: "צ13",
    latitude: 35.268734,
    longitude: -116.650706,
    description: "Northern checkpoint on the mission route.",
  });

  assert.throws(() => store.lookup("missing"), /Location not found/);
  store.close();
});

test("does not duplicate seeds when reopening the same database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dial-location-store-"));
  const path = join(directory, "locations.db");

  try {
    const first = new LocationStore(path);
    first.close();
    const second = new LocationStore(path);
    assert.equal(second.list().length, 5);
    second.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("updates existing seeded locations to the current coordinates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dial-location-migration-"));
  const path = join(directory, "locations.db");

  try {
    const database = new Database(path);
    database.exec(`
      CREATE TABLE locations (
        name TEXT PRIMARY KEY,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        description TEXT NOT NULL
      );
      INSERT INTO locations VALUES ('צ13', 31.7652, 35.2134, 'old');
      INSERT INTO locations VALUES ('obsolete', 31.7, 35.2, 'old');
    `);
    database.close();

    const store = new LocationStore(path);
    assert.deepEqual(store.lookup("צ13"), {
      name: "צ13",
      latitude: 35.268734,
      longitude: -116.650706,
      description: "Northern checkpoint on the mission route.",
    });
    assert.equal(store.list().length, 5);
    assert.throws(() => store.lookup("obsolete"), /Location not found/);
    store.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
