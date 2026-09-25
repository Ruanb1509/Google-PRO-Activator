"use client";

import { createContext, useContext } from "react";

export type Role = "ADMIN" | "STAFF" | "VIEWER";

export interface AdminInfo {
  id: string;
  email: string;
  name: string;
  role: Role;
  totpEnabled: boolean;
}

const rank: Record<Role, number> = { VIEWER: 1, STAFF: 2, ADMIN: 3 };

export const AdminContext = createContext<{ admin: AdminInfo; reload: () => void } | null>(null);

export function useAdmin(): AdminInfo {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used inside the dashboard layout");
  return ctx.admin;
}

export function useReloadAdmin(): () => void {
  return useContext(AdminContext)?.reload ?? (() => undefined);
}

/** True when the logged admin has at least `role`. */
export function useCan(role: Role): boolean {
  const ctx = useContext(AdminContext);
  return ctx ? rank[ctx.admin.role] >= rank[role] : false;
}
