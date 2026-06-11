import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type Location = {
  name: string;
  latitude: number;
  longitude: number;
  description: string;
};

const seedLocations: Location[] = [
  {
    name: "מייק",
    latitude: 35.268734,
    longitude: -116.650706,
    description: "Northern checkpoint on the mission route.",
  },
  {
    name: "דלתא",
    latitude: 35.267672,
    longitude: -116.656009,
    description: "Southern checkpoint on the mission route.",
  },
  {
    name: "גולף",
    latitude: 35.270774,
    longitude: -116.657988,
    description: "North-south approach road used in the mission scenario.",
  },
  {
    name: "טנגו",
    latitude: 35.270333,
    longitude: -116.653347,
    description: "East-west boundary road north of the checkpoints.",
  },
  {
    name: "אוסקר",
    latitude: 35.273822,
    longitude: -116.655204,
    description: "Drone home position and operations base.",
  },
];

export class LocationStore {
  private readonly database: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

    this.database = new Database(path);
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS locations (
        name TEXT PRIMARY KEY,
        latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
        longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
        description TEXT NOT NULL
      )
    `);

    const insert = this.database.prepare(`
      INSERT INTO locations (name, latitude, longitude, description)
      VALUES (@name, @latitude, @longitude, @description)
      ON CONFLICT(name) DO UPDATE SET
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        description = excluded.description
    `);
    const removeObsolete = this.database.prepare(`
      DELETE FROM locations
      WHERE name NOT IN (${seedLocations.map(() => "?").join(", ")})
    `);
    const seed = this.database.transaction((locations: Location[]) => {
      for (const location of locations) insert.run(location);
      removeObsolete.run(...locations.map((location) => location.name));
    });
    seed(seedLocations);
  }

  list(): Location[] {
    return this.database
      .prepare(
        `SELECT name, latitude, longitude, description
         FROM locations
         ORDER BY name COLLATE NOCASE`,
      )
      .all() as Location[];
  }

  lookup(name: string): Location {
    const location = this.database
      .prepare(
        `SELECT name, latitude, longitude, description
         FROM locations
         WHERE name = ?`,
      )
      .get(name.trim()) as Location | undefined;

    if (!location) throw new Error(`Location not found: ${name}`);
    return location;
  }

  close(): void {
    this.database.close();
  }
}
