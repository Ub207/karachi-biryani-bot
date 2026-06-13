// lib/menu-data.ts
import config from "@/config.json";

export const restaurantInfo = config.business;

export const menu = config.menu;

export const flatMenu: Record<string, number> = {};
for (const category of config.menu) {
  for (const item of category.items) {
    flatMenu[item.name] = item.price;
  }
}

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
