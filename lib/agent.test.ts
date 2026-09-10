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

  assert.deepEqual(routeDeterministically("2 chicken biryani", menu), {
    kind: "intent",
    intent: {
      intent: "ORDER",
      items: [{ name: "Chicken Biryani Single", qty: 2 }],
    },
  });

  assert.deepEqual(routeDeterministically("1 beef biryani", menu), {
    kind: "intent",
    intent: {
      intent: "ORDER",
      items: [{ name: "Beef Biryani Single", qty: 1 }],
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
    kind: "unavailable",
    itemName: "pizza",
  });
});

test("routes confirmations, cancellations, thanks, and contextual address deterministically", () => {
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
  assert.deepEqual(
    routeDeterministically("Shop 12, Tariq Road, Karachi", menu, "Aap ka *delivery address* kya hai?"),
    {
      kind: "intent",
      intent: { intent: "ADDRESS", items: [] },
    }
  );
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

test("full conversational order lifecycle (greeting -> menu -> order -> confirm -> address -> confirmation)", async () => {
  const { getAIResponse } = await import("./agent");
  const config = {
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
        ],
      },
      {
        category: "Sides",
        items: [
          { name: "Naan", price: 60 },
        ],
      },
    ],
  };

  const user = "test-user-999";
  const pid = "12345";

  // 1. Greeting
  const r1 = await getAIResponse(pid, user, "hi", config);
  assert.match(r1, /khush amdeed/i);

  // 2. Menu
  const r2 = await getAIResponse(pid, user, "menu", config);
  assert.match(r2, /Menu/i);
  assert.match(r2, /Chicken Biryani Single/);

  // 3. Order
  const r3 = await getAIResponse(pid, user, "1 chicken biryani single", config);
  assert.match(r3, /Aap ka Order/i);
  assert.match(r3, /Total:\s*Rs\.\s*500/i);

  // 4. Confirm
  const r4 = await getAIResponse(pid, user, "haan", config);
  assert.match(r4, /delivery address/i);

  // 5. Address
  const r5 = await getAIResponse(pid, user, "Flat 4B, Tariq Road, phone 03001234567", config);
  assert.match(r5, /Order confirm ho gaya/i);
  assert.match(r5, /ORD-/);

  // 6. Thanks
  const r6 = await getAIResponse(pid, user, "shukria", config);
  assert.match(r6, /shukriya/i);
});

test("greetings (hi, hello, salam, assalamualaikum) always return greeting without AI", async () => {
  const { getAIResponse } = await import("./agent");
  const config = {
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
    menu: [],
  };

  const pid = "test-greeting-pid";
  for (const greeting of ["hi", "hello", "salam", "assalamualaikum", "assalamu alaikum"]) {
    const user = `user-${greeting.replace(/\s+/g, "_")}`;
    const res = await getAIResponse(pid, user, greeting, config as any);
    assert.match(res, /khush amdeed/i, `Expected greeting response for "${greeting}"`);
    assert.match(res, /menu/i);
  }
});
