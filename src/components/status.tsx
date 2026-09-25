"use client";

import { Badge, type Tone } from "@/components/ui";

const ORDER: Record<string, [string, Tone]> = {
  PENDING: ["Pendente", "warn"],
  PAID: ["Pago", "info"],
  DELIVERED: ["Entregue", "ok"],
  FAILED: ["Falhou", "bad"],
  EXPIRED: ["Expirado", "neutral"],
  REFUNDED: ["Reembolsado", "accent"],
  CANCELLED: ["Cancelado", "neutral"],
};

const INVENTORY: Record<string, [string, Tone]> = {
  AVAILABLE: ["Disponível", "ok"],
  RESERVED: ["Reservado", "warn"],
  SOLD: ["Vendido", "info"],
  INVALID: ["Inválido", "bad"],
  CANCELLED: ["Cancelado", "neutral"],
};

const DEPOSIT: Record<string, [string, Tone]> = {
  PENDING: ["Pendente", "warn"],
  CONFIRMED: ["Confirmado", "ok"],
  EXPIRED: ["Expirado", "neutral"],
  REJECTED: ["Rejeitado", "bad"],
};

const TICKET: Record<string, [string, Tone]> = {
  OPEN: ["Aguardando equipe", "warn"],
  ANSWERED: ["Respondido", "info"],
  CLOSED: ["Encerrado", "neutral"],
};

export const TICKET_TYPE_LABELS: Record<string, string> = { PRE_SALE: "Pré-compra", POST_SALE: "Pós-compra" };

export const ORDER_STATUS_LABELS = Object.fromEntries(Object.entries(ORDER).map(([k, v]) => [k, v[0]]));
export const INVENTORY_STATUS_LABELS = Object.fromEntries(Object.entries(INVENTORY).map(([k, v]) => [k, v[0]]));
export const TICKET_STATUS_LABELS = Object.fromEntries(Object.entries(TICKET).map(([k, v]) => [k, v[0]]));
export const DEPOSIT_STATUS_LABELS = Object.fromEntries(Object.entries(DEPOSIT).map(([k, v]) => [k, v[0]]));

function make(map: Record<string, [string, Tone]>) {
  return function StatusBadge({ status }: { status: string }) {
    const [label, tone] = map[status] ?? [status, "neutral" as Tone];
    return <Badge tone={tone}>{label}</Badge>;
  };
}

export const OrderStatusBadge = make(ORDER);
export const PaymentStatusBadge = make(ORDER);
export const InventoryStatusBadge = make(INVENTORY);
export const DepositStatusBadge = make(DEPOSIT);
export const TicketStatusBadge = make(TICKET);

export const ROLE_LABELS: Record<string, string> = { ADMIN: "Administrador", STAFF: "Equipe", VIEWER: "Visualizador" };
