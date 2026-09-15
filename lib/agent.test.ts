import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeIntent,
  parseIntentResponse,
  routeDeterministically,
} from "./agent";
import { ClientConfig } from "./client-config";

const menu = {
  "Chicken Biryani Single": 350,
  "Chicken Biryani Family Pack": 1200,
  "Beef Biryani Single": 400,
  Naan: 60,
  "Garlic Naan": 100,
  "Chicken Karahi Half": 1100,
  "Chicken Karahi Full": 2000,
};

test("routes menu commands without AI classification", () => {
  for (const message of ["menu", " MENU ", "show menu", "menu please", "prices", "rate list"]) {
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

  assert.deepEqual(routeDeterministically("1 chicken biryani", menu), {
    kind: "intent",
    intent: {
      intent: "ORDER",
      items: [{ name: "Chicken Biryani Single", qty: 1 }],
    },
  });

  assert.deepEqual(routeDeterministically("2 beef biryani", menu), {
    kind: "intent",
    intent: {
      intent: "ORDER",
      items: [{ name: "Beef Biryani Single", qty: 2 }],
    },
  });

  assert.deepEqual(routeDeterministically("family pack", menu), {
    kind: "intent",
    intent: {
      intent: "ORDER",
      items: [{ name: "Chicken Biryani Family Pack", qty: 1 }],
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
    kind: "ITEM_NOT_AVAILABLE",
    itemName: "pizza",
  });
});

for (const message of ["pizza h?", "burger hai?", "shawarma hai?", "pasta hai?"]) {
  test(`availability query "${message}" routes to ITEM_NOT_AVAILABLE, never an error`, () => {
    assert.deepEqual(routeDeterministically(message, menu), {
      kind: "ITEM_NOT_AVAILABLE",
      itemName: message === "pizza h?" ? "pizza" : message.split(" ")[0],
    });
  });
}

test("availability query for a real item routes to ITEM_CHECK", () => {
  assert.deepEqual(routeDeterministically("chicken biryani hai?", menu), {
    kind: "intent",
    intent: { intent: "ITEM_CHECK", items: [{ name: "Chicken Biryani Single", qty: 1 }] },
  });
  assert.deepEqual(routeDeterministically("chicken biryani nahi hai?", menu), {
    kind: "intent",
    intent: { intent: "ITEM_CHECK", items: [{ name: "Chicken Biryani Single", qty: 1 }] },
  });
});

test("cheapest item query routes to CHEAPEST_ITEM", () => {
  assert.deepEqual(routeDeterministically("sab se sasti cheez kya hai?", menu), {
    kind: "CHEAPEST_ITEM",
    item: "Naan",
    price: 60,
  });
});

test("budget queries route to BUDGET_QUERY", () => {
  const res = routeDeterministically("800 se kam mein kya milega?", menu);
  assert.equal(res?.kind, "BUDGET_QUERY");
  if (res?.kind === "BUDGET_QUERY") {
    assert.equal(res.budget, 800);
    assert.ok(res.items.some((i) => i.name === "Naan" && i.price === 60));
    assert.ok(res.items.some((i) => i.name === "Chicken Biryani Single" && i.price === 350));
    assert.ok(!res.items.some((i) => i.price > 800));
  }
});

test("delivery area and ETA queries route deterministically", () => {
  assert.deepEqual(routeDeterministically("delivery Karachi mein hai?", menu), {
    kind: "DELIVERY_AREAS",
  });
  assert.deepEqual(routeDeterministically("kitni dair lagegi?", menu), {
    kind: "DELIVERY_ETA",
  });
});

test("ambiguous order query 'mujhe 5 biryani chahiye' asks for clarification", () => {
  assert.deepEqual(routeDeterministically("mujhe 5 biryani chahiye", menu), {
    kind: "ambiguous",
    itemName: "biryani",
    matches: ["Chicken Biryani Single", "Chicken Biryani Family Pack", "Beef Biryani Single"],
  });
});

test("order status query routes deterministically", () => {
  assert.deepEqual(routeDeterministically("mera order kahan hai?", menu), {
    kind: "ORDER_STATUS",
    orderId: undefined,
  });
  assert.deepEqual(routeDeterministically("order ORD-123456", menu), {
    kind: "ORDER_STATUS",
    orderId: "ORD-123456",
  });
});


test("routes confirmations, cancellations, thanks deterministically", () => {
  assert.deepEqual(routeDeterministically("haan", menu), {
    kind: "intent",
    intent: { intent: "CONFIRM", items: [] },
  });
  assert.deepEqual(routeDeterministically("theek hai", menu), {
    kind: "intent",
    intent: { intent: "CONFIRM", items: [] },
  });
  assert.deepEqual(routeDeterministically("nahi", menu), {
    kind: "intent",
    intent: { intent: "CANCEL", items: [] },
  });
  assert.deepEqual(routeDeterministically("shukria", menu), {
    kind: "intent",
    intent: { intent: "THANKS", items: [] },
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

const testConfig: ClientConfig = {
  phoneNumberId: "12345",
  whatsappToken: "token",
  business: {
    name: "Karachi Biryani House",
    address: "Shop 12, Tariq Road, Karachi",
    hours: "12:00 AM - 11:59 PM (Daily)",
    phone: "+92-300-1234567",
    deliveryAreas: ["Tariq Road", "PECHS"],
    minimumOrder: 100,
    deliveryFee: 150,
    deliveryTime: "30-45 minutes",
    currency: "Rs.",
  },
  menu: [
    {
      category: "Biryani",
      items: [
        { name: "Chicken Biryani Single", price: 350 },
        { name: "Beef Biryani Single", price: 400 },
      ],
    },
    {
      category: "Sides",
      items: [{ name: "Naan", price: 60 }],
    },
  ],
};

test("unsupported items get a friendly menu reply, never a technical error", async () => {
  const { getAIResponse } = await import("./agent");
  for (const message of ["pizza h?", "burger hai?", "shawarma hai?", "pasta hai?"]) {
    const reply = await getAIResponse("pid-unavailable", `user-${message}`, message, testConfig);
    assert.doesNotMatch(reply, /technical|error|issue/i, `reply for "${message}" must not mention errors: ${reply}`);
    assert.match(reply, /available nahi hai/i, `reply for "${message}": ${reply}`);
    assert.match(reply, /Chicken Biryani/i, `reply for "${message}" should list menu: ${reply}`);
    assert.match(reply, /order karna chahenge/i, `reply for "${message}" should invite order: ${reply}`);
  }
});

test("full ordering workflow: item -> quantity -> address -> confirm (spec scenario)", async () => {
  const { getAIResponse } = await import("./agent");
  const pid = "pid-workflow";
  const user = "workflow-user-1";

  const r1 = await getAIResponse(pid, user, "1 chicken biryani", testConfig);
  assert.match(r1, /quantity chahiye/i, r1);

  const r2 = await getAIResponse(pid, user, "2", testConfig);
  assert.match(r2, /address batayein/i, r2);

  const r3 = await getAIResponse(pid, user, "Gulshan Block 5", testConfig);
  assert.match(r3, /Aapka order/i, r3);
  assert.match(r3, /2 Chicken Biryani Single/i, r3);
  assert.match(r3, /Rs\. 700/i, r3);
  assert.match(r3, /Rs\. 150/i, r3);
  assert.match(r3, /Confirm karein/i, r3);
  assert.match(r3, /Yes \/ No/i, r3);

  const r4 = await getAIResponse(pid, user, "Yes", testConfig);
  assert.match(r4, /Order confirm ho gaya/i, r4);
  assert.match(r4, /ORD-[A-Z0-9]+/i, r4);
  assert.match(r4, /30-45 minutes/i, r4);
});

test("state management: item, quantity, address, confirmation survive across turns", async () => {
  const { getOrderDraft } = await import("./orders");
  const { getAIResponse } = await import("./agent");
  const pid = "pid-state";
  const user = "state-user-1";

  await getAIResponse(pid, user, "2 beef biryani", testConfig);
  let draft = await getOrderDraft(pid, user);
  assert.ok(draft, "draft saved after item selection");
  assert.equal(draft.phase, "AWAITING_QUANTITY");
  assert.equal(draft.items[0].name, "Beef Biryani Single");

  await getAIResponse(pid, user, "2", testConfig);
  draft = await getOrderDraft(pid, user);
  assert.equal(draft!.phase, "AWAITING_ADDRESS");
  assert.equal(draft!.items[0].qty, 2);

  await getAIResponse(pid, user, "PECHS D Block", testConfig);
  draft = await getOrderDraft(pid, user);
  assert.equal(draft!.phase, "AWAITING_CONFIRMATION");
  assert.equal(draft!.address, "PECHS D Block");
  assert.equal(draft!.confirmation, "PENDING");
  assert.equal(draft!.total, 800 + 150);

  const r = await getAIResponse(pid, user, "haan", testConfig);
  assert.match(r, /confirm ho gaya/i);
  draft = await getOrderDraft(pid, user);
  assert.equal(draft, null, "draft cleared after confirmation");
});

test("cancel works at every phase of an active order", async () => {
  const { getAIResponse } = await import("./agent");
  const pid = "pid-cancel";

  let user = "cancel-qty";
  await getAIResponse(pid, user, "1 chicken biryani", testConfig);
  const r1 = await getAIResponse(pid, user, "cancel", testConfig);
  assert.match(r1, /cancel ho gaya/i);

  user = "cancel-confirm";
  await getAIResponse(pid, user, "1 chicken biryani", testConfig);
  await getAIResponse(pid, user, "2", testConfig);
  await getAIResponse(pid, user, "Gulshan", testConfig);
  const r2 = await getAIResponse(pid, user, "nahi", testConfig);
  assert.match(r2, /cancel ho gaya/i);
});

test("quantity phase reprompts on invalid input, address phase accepts free text", async () => {
  const { getAIResponse } = await import("./agent");
  const pid = "pid-prompts";
  const user = "prompts-user";

  const r1 = await getAIResponse(pid, user, "1 chicken biryani", testConfig);
  assert.match(r1, /quantity chahiye/i);
  const r2 = await getAIResponse(pid, user, "abhi nahi pata", testConfig);
  // Non-numeric during quantity phase: treated as a fresh request, never an error
  assert.doesNotMatch(r2, /technical|error/i, r2);
});

test("greetings (hi, hello, salam, assalamualaikum) always return greeting without AI", async () => {
  const { getAIResponse } = await import("./agent");
  const config: ClientConfig = {
    ...testConfig,
    phoneNumberId: "12345",
    menu: [],
  };

  const pid = "test-greeting-pid";
  for (const greeting of ["hi", "hello", "salam", "assalamualaikum", "assalamu alaikum"]) {
    const user = `user-${greeting.replace(/\s+/g, "_")}`;
    const res = await getAIResponse(pid, user, greeting, config);
    assert.match(res, /khush amdeed/i, `Expected greeting response for "${greeting}"`);
    assert.match(res, /menu/i);
  }
});

test("menu flow: greeting -> menu -> order -> quantity -> address -> confirm -> thanks", async () => {
  const { getAIResponse } = await import("./agent");
  const pid = "pid-lifecycle";
  const user = "lifecycle-user";

  assert.match(await getAIResponse(pid, user, "hi", testConfig), /khush amdeed/i);
  const menuReply = await getAIResponse(pid, user, "menu", testConfig);
  assert.match(menuReply, /Chicken Biryani Single/);

  assert.match(await getAIResponse(pid, user, "1 chicken biryani", testConfig), /quantity chahiye/i);
  assert.match(await getAIResponse(pid, user, "2", testConfig), /address batayein/i);
  const summary = await getAIResponse(pid, user, "Flat 4B, Tariq Road", testConfig);
  assert.match(summary, /Aapka order/i);
  assert.match(summary, /Rs\. 700/i);
  const done = await getAIResponse(pid, user, "yes", testConfig);
  assert.match(done, /Order confirm ho gaya/i);
  assert.match(done, /ORD-/);
  assert.match(await getAIResponse(pid, user, "shukria", testConfig), /shukriya/i);
});

test("flow tests for product inquiries, cheapest, budget, delivery, eta, ambiguous order, tracking", async () => {
  const { getAIResponse } = await import("./agent");
  const pid = "pid-queries";
  const user = "query-user-1";

  // 1. chicken biryani nahi hai?
  const r1 = await getAIResponse(pid, user, "chicken biryani nahi hai?", testConfig);
  assert.match(r1, /Chicken Biryani Single.*available hai/i);

  // 2. sab se sasti cheez kya hai?
  const r2 = await getAIResponse(pid, user, "sab se sasti cheez kya hai?", testConfig);
  assert.match(r2, /sab se sasti item.*Naan.*60/i);

  // 3. 800 se kam mein kya milega?
  const r3 = await getAIResponse(pid, user, "800 se kam mein kya milega?", testConfig);
  assert.match(r3, /800 ke budget mein yeh items available hain/i);
  assert.match(r3, /Chicken Biryani Single/i);

  // 4. delivery Karachi mein hai?
  const r4 = await getAIResponse(pid, user, "delivery Karachi mein hai?", testConfig);
  assert.match(r4, /Tariq Road/i);
  assert.match(r4, /PECHS/i);

  // 5. kitni dair lagegi?
  const r5 = await getAIResponse(pid, user, "kitni dair lagegi?", testConfig);
  assert.match(r5, /30-45 minutes/i);

  // 6. mujhe 5 biryani chahiye -> ambiguous
  const r6 = await getAIResponse(pid, user, "mujhe 5 biryani chahiye", testConfig);
  assert.match(r6, /"biryani" mein kaunsa chahiye/i);

  // 7. mera order kahan hai? (before any order)
  const r7 = await getAIResponse(pid, "user-no-order", "mera order kahan hai?", testConfig);
  assert.match(r7, /koi recent order record mein nahi mila/i);

  // 8. complete an order, then ask "mera order kahan hai?"
  const ordUser = "user-tracked-1";
  await getAIResponse(pid, ordUser, "1 chicken biryani", testConfig);
  await getAIResponse(pid, ordUser, "2", testConfig);
  await getAIResponse(pid, ordUser, "PECHS Block 2", testConfig);
  const confirmRes = await getAIResponse(pid, ordUser, "yes", testConfig);
  const orderIdMatch = confirmRes.match(/ORD-[A-Z0-9]+/);
  assert.ok(orderIdMatch, "order ID generated");

  const r8 = await getAIResponse(pid, ordUser, "mera order kahan hai?", testConfig);
  assert.match(r8, new RegExp(orderIdMatch[0]), "status retrieved caller's order");
  assert.match(r8, /PECHS Block 2/i);

  // 9. unrelated question -> polite fallback, never a technical error
  const r9 = await getAIResponse(pid, "user-unrelated", "who is the president?", testConfig);
  assert.doesNotMatch(r9, /technical|issue/i);
  assert.match(r9, /Karachi Biryani House/i);
});

