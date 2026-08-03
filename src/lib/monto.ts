import type { PartidoEstado } from "@/lib/db/types";

export type ResultadoMontoPorJugador =
  | { disponible: true; monto: number }
  | { disponible: false };

export const MENSAJE_MONTO_PENDIENTE = "Se calculará al completar el partido";

/**
 * "Completo" es exactamente lo que ya define partido.estado: los triggers
 * lo marcan 'completo' cuando los titulares (Team1+Team2) llegan al cupo.
 * 'cerrado' también cuenta: ya no hay más cambios posibles, así que el
 * monto final queda fijo aunque el organizador haya cerrado con menos
 * titulares que el cupo original.
 *
 * Esta regla es la ÚNICA fuente de verdad de "¿ya se puede mostrar el
 * monto?" en toda la UI. La vista del jugador no recibe costo_total (por
 * privacidad: esa cifra la calcula el servidor), así que necesita esta
 * mitad sola para decidir si mostrar el monto que ya le llegó calculado.
 */
export function montoDisponibleSegunEstado(estado: PartidoEstado): boolean {
  return estado !== "abierto";
}

/**
 * Única fuente de verdad para CALCULAR el monto por jugador (organizador,
 * que sí tiene costo_total a mano).
 *
 * `titulares` tiene que ser la cantidad real de jugadores que reparten el
 * costo (Team1 + Team2), no el total de anotados: la reserva no paga.
 */
export function calcularMontoPorJugador(
  costoTotal: number,
  titulares: number,
  estado: PartidoEstado,
): ResultadoMontoPorJugador {
  if (!montoDisponibleSegunEstado(estado)) return { disponible: false };
  if (titulares <= 0) return { disponible: false };
  return { disponible: true, monto: costoTotal / titulares };
}
