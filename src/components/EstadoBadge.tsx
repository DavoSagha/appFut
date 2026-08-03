"use client";

import type { PartidoEstado } from "@/lib/db/types";

/**
 * Fuente única del color y la etiqueta del estado de un partido.
 *
 * El color sigue la misma semántica que PagoBadge, para que verde signifique
 * lo mismo en toda la app:
 *   abierto  -> ámbar: falta gente, el plantel se está armando (en curso)
 *   completo -> verde: el plantel llegó al cupo (es el objetivo cumplido)
 *   cerrado  -> gris:  ya no admite cambios (inactivo)
 *
 * Antes `abierto` era verde y `completo` azul, o sea justo al revés: el
 * estado incompleto se veía como "listo" y contradecía el cartel de
 * "Se calculará al completar el partido" que aparece al lado.
 */
const config: Record<PartidoEstado, { label: string; clase: string }> = {
  abierto:  { label: "Abierto",  clase: "bg-[var(--pendiente)]/15 text-[var(--pendiente)]" },
  completo: { label: "Completo", clase: "bg-[var(--confirmado)]/15 text-[var(--confirmado)]" },
  cerrado:  { label: "Cerrado",  clase: "bg-[var(--inactivo)]/20 text-[var(--inactivo)]" },
};

export default function EstadoBadge({ estado }: { estado: PartidoEstado }) {
  const c = config[estado];
  return (
    <span
      className={`text-sm font-medium px-2.5 py-1 rounded-full min-h-[28px] inline-flex items-center shrink-0 whitespace-nowrap ${c.clase}`}
    >
      {c.label}
    </span>
  );
}
