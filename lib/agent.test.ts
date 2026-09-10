import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeIntent,
  parseIntentResponse,
  routeDeterministically,
} from "./agent";

const menu = {
  "Chicken Biryani Single": 350,
  "Chicken Biryani Family Pack": 1200,
  Naan: 60,
  "Garlic Naan": 100,
  "Chicken Karahi Half": 1100,
  "Chicken Karahi Full": 2000,
};

test("routes menu commands without AI classification", () => {
  for (const message of ["menu", " MENU ", "show menu", "menu please"]) {
    assert.deepEqual(routeDeterministically(message, menu), {
      kind: "intent",
      intent: { intent: "MENU", items: [] },
    });
  }
});

test("routes explicit tenant-menu orders without AI classification", () => {
  assert.deepEqual(routeDeterministically("1 chicken biryani, 2x naan", menu), {
    kind: "intent",
    intent: {
      intent: "ORDER",
      items: [
        { name: "Chicken Biryani Single", qty: 1 },
        { name: "Naan", qty: 2 },
      ],
    },
  });
});

test("clarifies ambiguous orders and rejects unavailable explicit orders", () => {
  assert.deepEqual(routeDeterministically("1 chicken karahi", menu), {
    kind: "ambiguous",
    itemName: "chicken karahi",
    matches: ["Chicken Karahi Half", "Chicken Karahi Full"],
  });
  assert.deepEqual(routeDeterministically("1 pizza", menu), {
    kind: "unavailable",
    itemName: "pizza",
  });
});

test("normalizes classifier intent and rejects malformed items", () => {
  assert.equal(normalizeIntent(" order "), "ORDER");
  assert.equal(normalizeIntent("show_menu"), "UNKNOWN");
  assert.deepEqual(parseIntentResponse('{"intent":" menu ","items":[{"name":"Naan","qty":2}]}'), {
    intent: "MENU",
    items: [{ name: "Naan", qty: 2 }],
  });
  assert.deepEqual(parseIntentResponse('{"intent":"ORDER","items":[{"name":"Naan","qty":0}]}'), {
    intent: "ORDER",
    items: [],
  });
});
