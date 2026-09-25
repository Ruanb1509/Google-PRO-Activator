export interface StockCounts {
  available: number;
  reserved: number;
  sold: number;
  invalid: number;
  cancelled: number;
}

export interface Product {
  id: string;
  name: string;
  nameEn: string | null;
  description: string;
  descriptionEn: string | null;
  category: string;
  priceBrlCents: number;
  priceUsdCents: number;
  isActive: boolean;
  lowStockThreshold: number | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductWithStock extends Product {
  stock: StockCounts;
  lowStock: boolean;
}

export interface ProductDetail extends ProductWithStock {
  effectiveLowStockThreshold: number;
}

export interface MiniUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName?: string | null;
}

export function userLabel(u: { username?: string | null; firstName?: string | null; telegramId?: string } | null | undefined): string {
  if (!u) return "—";
  if (u.username) return `@${u.username}`;
  return u.firstName || u.telegramId || "—";
}
