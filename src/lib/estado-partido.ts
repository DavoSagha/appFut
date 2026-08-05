import type { PartidoEstado } from "@/lib/db/types";

/**
 * "Ya se jugó" NO es un estado que alguien escriba: es una función de
 * `fecha_hora` y del reloj. Por eso NO se guarda en la base.
 *
 * Si se persistiera haría falta un job (pg_cron / edge function) que lo
 * escriba, y entre el instante en que pasa la hora y el instante en que
 * corre el job la columna `estado` estaría mintiendo. Derivarlo en cada
 * lectura no puede desincronizarse nunca.
 *
 * La columna `partidos.estado` sigue guardando la INTENCIÓN (el organizador
 * cerró / los triggers marcaron completo). El vencimiento es la CONSECUENCIA
 * y se calcula acá. Mismo criterio que ya usaba `eliminarPartidoConResiduos`
 * en `src/lib/borrado.ts` para decidir si un partido ya se jugó.
 */
export function partidoVencido(
  fechaHora: string | Date,
  ahora: Date = new Date(),
): boolean {
  const fecha = fechaHora instanceof Date ? fechaHora : new Date(fechaHora);
  // Una fecha ilegible se trata como NO vencida a propósito: ante un dato roto
  // preferimos dejar el partido operable antes que trabarlo sin salida.
  if (Number.isNaN(fecha.getTime())) return false;
  return fecha.getTime() <= ahora.getTime();
}

/**
 * Única fuente de verdad del estado que ve el usuario y que gobierna los
 * gates de la UI. Un partido vencido se comporta como 'cerrado' aunque la
 * columna diga 'abierto' o 'completo'.
 *
 * Ojo: los pagos NO usan esto. Declarar y confirmar pagos se sigue midiendo
 * contra el estado GUARDADO, porque en el fútbol amateur se paga después de
 * jugar y el vencimiento no puede trabar la cobranza.
 */
export function estadoEfectivo(
  partido: { estado: PartidoEstado; fecha_hora: string | Date },
  ahora: Date = new Date(),
): PartidoEstado {
  return partidoVencido(partido.fecha_hora, ahora) ? "cerrado" : partido.estado;
}
