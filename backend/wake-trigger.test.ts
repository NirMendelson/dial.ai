import assert from "node:assert/strict";
import test from "node:test";
import { containsWakeName, getLatestUserTurn } from "./wake-trigger.js";

const wakeName = "ברק 1";

test("detects the wake name with common punctuation and spacing", () => {
  assert.equal(containsWakeName("ברק 1, עבור לנקודה צ13", wakeName), true);
  assert.equal(containsWakeName("ברק-1 עבור לנקודה צ13", wakeName), true);
  assert.equal(containsWakeName("ברק־1, האם אתה שומע?", wakeName), true);
});

test("does not match ordinary speech or partial numbers", () => {
  assert.equal(containsWakeName("הכוח מתקדם צפונה", wakeName), false);
  assert.equal(containsWakeName("ברק 10, הישאר במקום", wakeName), false);
  assert.equal(containsWakeName("ברק", wakeName), false);
});

test("checks the latest human turn instead of an older wake command", () => {
  const latest = getLatestUserTurn([
    { role: "user", content: "ברק 1, עבור לנקודה צ13" },
    { role: "agent", content: "קיבלתי" },
    { role: "user", content: "הכוח ממשיך צפונה" },
  ]);

  assert.deepEqual(latest, { content: "הכוח ממשיך צפונה", index: 2 });
  assert.equal(containsWakeName(latest?.content ?? "", wakeName), false);
});
