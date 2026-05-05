import { menu } from "./menu-data";

export function normalizeItemName(input: string): string | null {
  const lower = input.toLowerCase();

  const match = Object.keys(menu).find((item) =>
    lower.includes(item.toLowerCase())
  );

  return match || null;
}