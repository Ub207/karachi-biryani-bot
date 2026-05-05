// lib/menu-data.ts

export const restaurantInfo = {
  name: "Karachi Biryani House",
  address: "Shop 12, Tariq Road, Karachi",
  hours: "11:00 AM - 11:00 PM (Daily)",
  phone: "+92-300-1234567",
  deliveryAreas: ["Tariq Road", "PECHS", "Bahadurabad", "Defence", "Clifton"],
  minimumOrder: 800,
  deliveryFee: 150,
  deliveryTime: "30-45 minutes",
};

// Flat menu - single source of truth
export const flatMenu: Record<string, number> = {
  "Chicken Biryani Single": 350,
  "Chicken Biryani Family Pack": 1200,
  "Beef Biryani Single": 400,
  "Mutton Biryani Single": 550,
  "Sindhi Biryani Single": 380,
  "Chicken Karahi Half": 1100,
  "Chicken Karahi Full": 2000,
  "Mutton Karahi Half": 1800,
  "Seekh Kebab": 600,
  "Chicken Tikka": 700,
  "Naan": 60,
  "Garlic Naan": 100,
  "Raita": 80,
  "Coke 1.5L": 250,
  "Lassi": 150,
};

// Original structured menu (for category display)
export const menu = [
  {
    category: "Biryani",
    items: [
      { id: "B1", name: "Chicken Biryani Single", price: 350 },
      { id: "B2", name: "Chicken Biryani Family Pack", price: 1200 },
      { id: "B3", name: "Beef Biryani Single", price: 400 },
      { id: "B4", name: "Mutton Biryani Single", price: 550 },
      { id: "B5", name: "Sindhi Biryani Single", price: 380 },
    ],
  },
  {
    category: "BBQ & Karahi",
    items: [
      { id: "K1", name: "Chicken Karahi Half", price: 1100 },
      { id: "K2", name: "Chicken Karahi Full", price: 2000 },
      { id: "K3", name: "Mutton Karahi Half", price: 1800 },
      { id: "K4", name: "Seekh Kebab", price: 600 },
      { id: "K5", name: "Chicken Tikka", price: 700 },
    ],
  },
  {
    category: "Sides & Drinks",
    items: [
      { id: "S1", name: "Naan", price: 60 },
      { id: "S2", name: "Garlic Naan", price: 100 },
      { id: "S3", name: "Raita", price: 80 },
      { id: "D1", name: "Coke 1.5L", price: 250 },
      { id: "D2", name: "Lassi", price: 150 },
    ],
  },
];

export function getMenuText(): string {
  let text = `📋 *${restaurantInfo.name} Menu*\n\n`;
  menu.forEach((cat) => {
    text += `*${cat.category}:*\n`;
    cat.items.forEach((item) => {
      text += `• ${item.name} - Rs. ${item.price}\n`;
    });
    text += "\n";
  });
  text += `_Min order: Rs. ${restaurantInfo.minimumOrder}_\n`;
  text += `_Delivery: Rs. ${restaurantInfo.deliveryFee} (${restaurantInfo.deliveryTime})_`;
  return text;
}