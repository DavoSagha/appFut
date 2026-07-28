"use client";

import type { PagoEstado } from "@/lib/db/types";

const config: Record<PagoEstado, { label: string; dot: string; bg: string }> = {
  sin_declarar:         { label: "Sin pagar",               dot: "bg-gray-500",  bg: "bg-gray-500/15 text-gray-400" },
  pendiente_confirmacion: { label: "Pendiente revisión",    dot: "bg-amber-400", bg: "bg-amber-400/15 text-amber-400" },
  confirmado:           { label: "Pagado",                   dot: "bg-green-500", bg: "bg-green-500/15 text-green-500" },
  rechazado:            { label: "Rechazado",                dot: "bg-red-500",   bg: "bg-red-500/15 text-red-400" },
};

type Props = {
  estado: PagoEstado;
  onClick?: () => void;
};

export default function PagoBadge({ estado, onClick }: Props) {
  const c = config[estado];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium min-h-[28px] ${c.bg} ${onClick ? "cursor-pointer hover:brightness-110 active:scale-95 transition-all" : "cursor-default"}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </button>
  );
}
