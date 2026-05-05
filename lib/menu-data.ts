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

/**
 * 📦 STRUCTURED MENU (for UI + display)
 */
export const menu = [
  {
    category: "Biryani (Specialty)",
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
      { id: "K4", name: "Seekh Kebab (6 pcs)", price: 600 },
      { id: "K5", name: "Chicken Tikka (4 pcs)", price: 700 },
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

/**
 * ⚡ FLAT MAP (CRITICAL FOR BACKEND LOGIC)
 * This is what pricing engine MUST use
 */
export const menuMap: Record<
  string,
  { id: string; name: string; price: number }
> = {
  B1: { id: "B1", name: "Chicken Biryani Single", price: 350 },
  B2: { id: "B2", name: "Chicken Biryani Family Pack", price: 1200 },
  B3: { id: "B3", name: "Beef Biryani Single", price: 400 },
  B4: { id: "B4", name: "Mutton Biryani Single", price: 550 },
  B5: { id: "B5", name: "Sindhi Biryani Single", price: 380 },

  K1: { id: "K1", name: "Chicken Karahi Half", price: 1100 },
  K2: { id: "K2", name: "Chicken Karahi Full", price: 2000 },
  K3: { id: "K3", name: "Mutton Karahi Half", price: 1800 },
  K4: { id: "K4", name: "Seekh Kebab (6 pcs)", price: 600 },
  K5: { id: "K5", name: "Chicken Tikka (4 pcs)", price: 700 },

  S1: { id: "S1", name: "Naan", price: 60 },
  S2: { id: "S2", name: "Garlic Naan", price: 100 },
  S3: { id: "S3", name: "Raita", price: 80 },
  D1: { id: "D1", name: "Coke 1.5L", price: 250 },
  D2: { id: "D2", name: "Lassi", price: 150 },
};

/**
 * 🧾 SAFE MENU TEXT (ONLY FOR DISPLAY / WHATSAPP VIEW)
 */
export function getMenuText(): string {
  let text = `*${restaurantInfo.name} Menu*\n\n`;

  menu.forEach((cat) => {
    text += `*${cat.category}*\n`;

    cat.items.forEach((item) => {
      text += `${item.id}. ${item.name} - Rs. ${item.price}\n`;
    });

    text += "\n";
  });

  text += `_Minimum order: Rs. ${restaurantInfo.minimumOrder}_\n`;
  text += `_Delivery fee: Rs. ${restaurantInfo.deliveryFee}_`;

  return text;
}