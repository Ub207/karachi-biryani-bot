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
 * ⚡ FLAT MENU (USED FOR PRICING ENGINE)
 */
export const menu: Record<string, number> = {
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