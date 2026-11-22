// The sandbox restaurant's menu (Decision 1). Customers order from this; the rules
// check every order line's name and price against it. Prices are whole rupees.
import type { MenuItem } from "./docs.ts";

export const SANDBOX_RESTAURANT_NAME = "FairClaim Demo Kitchen";

export const SEED_MENU: Readonly<Record<string, MenuItem>> = {
  biryani: { name: "Chicken Biryani", price: 380 },
  "paneer-tikka": { name: "Paneer Tikka", price: 290 },
  "dal-makhani": { name: "Dal Makhani", price: 240 },
  "butter-naan": { name: "Butter Naan", price: 60 },
  "masala-dosa": { name: "Masala Dosa", price: 150 },
  "gulab-jamun": { name: "Gulab Jamun", price: 180 },
  raita: { name: "Raita", price: 80 },
  "mango-lassi": { name: "Mango Lassi", price: 120 },
};
