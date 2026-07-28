import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Borrado de un partido sin dejar residuos.
 *
 * Recibe el cliente por parámetro (no importa `server-only`) para que el
 * test de integración ejerza ESTA misma función y no una reimplementación.
 */

export const BUCKET_COMPROBANTES = "comprobantes";

export type ResultadoBorrado =
  | { ok: true }
  | {
      ok: false;
      motivo: "sin_permiso" | "todavia_no_jugado" | "storage" | "db";
      causa?: unknown;
    };

/**
 * Junta las rutas de todos los comprobantes de un partido.
 *
 * Dos fuentes, a propósito:
 *  1. `pagos.comprobante_url`, que es la ruta canónica.
 *  2. Un barrido del bucket, porque si alguna vez el upload salió bien y el
 *     UPDATE de la fila falló, ese archivo no figura en ninguna tabla.
 * Sin el barrido, esos quedarían huérfanos para siempre.
 */
export async function rutasDeComprobantes(
  supabase: SupabaseClient,
  partidoId: string
): Promise<string[]> {
  const rutas = new Set<string>();

  const { data: jugadores } = await supabase
    .from("jugadores")
    .select("id")
    .eq("partido_id", partidoId);

  const ids = (jugadores ?? []).map((j) => j.id as string);

  if (ids.length > 0) {
    const { data: pagos } = await supabase
      .from("pagos")
      .select("comprobante_url")
      .in("jugador_id", ids);

    for (const p of pagos ?? []) {
      if (p.comprobante_url) rutas.add(p.comprobante_url as string);
    }
  }

  // list() no es recursivo: hay que bajar carpeta por carpeta.
  const { data: carpetas } = await supabase.storage
    .from(BUCKET_COMPROBANTES)
    .list(partidoId);

  for (const carpeta of carpetas ?? []) {
    const { data: archivos } = await supabase.storage
      .from(BUCKET_COMPROBANTES)
      .list(`${partidoId}/${carpeta.name}`);
    for (const archivo of archivos ?? []) {
      rutas.add(`${partidoId}/${carpeta.name}/${archivo.name}`);
    }
  }

  return [...rutas];
}

/**
 * Orden importante:
 *   1. Storage primero. La policy de storage se apoya en que el partido
 *      exista para saber quién sos; si borrás la fila antes, perdés el
 *      permiso sobre tus propios archivos y quedan huérfanos.
 *   2. La fila después. jugadores y pagos se van solos por CASCADE.
 */
export async function eliminarPartidoConResiduos(
  supabase: SupabaseClient,
  partidoId: string
): Promise<ResultadoBorrado> {
  const { data: partido } = await supabase
    .from("partidos")
    .select("id, fecha_hora")
    .eq("id", partidoId)
    .single();

  if (!partido) return { ok: false, motivo: "sin_permiso" };

  if (new Date(partido.fecha_hora as string) > new Date()) {
    return { ok: false, motivo: "todavia_no_jugado" };
  }

  const rutas = await rutasDeComprobantes(supabase, partidoId);
  if (rutas.length > 0) {
    const { error } = await supabase.storage
      .from(BUCKET_COMPROBANTES)
      .remove(rutas);
    // Si los archivos no se pueden borrar, no seguimos: preferimos un partido
    // vivo antes que comprobantes bancarios huérfanos y sin dueño.
    if (error) return { ok: false, motivo: "storage", causa: error };
  }

  const { data, error } = await supabase
    .from("partidos")
    .delete()
    .eq("id", partidoId)
    .select("id");

  if (error) return { ok: false, motivo: "db", causa: error };
  if (!data || data.length === 0) return { ok: false, motivo: "sin_permiso" };

  return { ok: true };
}
