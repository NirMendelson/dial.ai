import assert from "node:assert/strict";
import { test } from "node:test";
import { calculatePosition, directions } from "./position.js";

test("calculates positions in every supported direction", () => {
  const reference = { latitude: 31.7652, longitude: 35.2134 };

  for (const direction of directions) {
    const result = calculatePosition(reference, direction, 300);
    assert.ok(result.latitude >= -90 && result.latitude <= 90);
    assert.ok(result.longitude >= -180 && result.longitude <= 180);
    assert.notDeepEqual(result, reference);
  }

  const northeast = calculatePosition(reference, "northeast", 300);
  assert.ok(northeast.latitude > reference.latitude);
  assert.ok(northeast.longitude > reference.longitude);
});

test("rejects invalid coordinates and distances", () => {
  assert.throws(
    () => calculatePosition({ latitude: 91, longitude: 0 }, "north", 100),
    /outside valid bounds/,
  );
  assert.throws(
    () => calculatePosition({ latitude: 0, longitude: 0 }, "north", 0),
    /greater than zero/,
  );
});

