"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { esUuid, fallo, falloDe, organizadorActual } from "@/lib/auth-guard";
import { generarSlug, validarFechaPartido, validarResultado } from "@/lib/validaciones";
import { eliminarPartidoConResiduos } from "@/lib/borrado";

export async function crearPartido(input: {
  fechaHora: string;
  cantidadJugadores: number;
  costoTotal: number;
}) {
  const userId = await organizadorActual();
  if (!userId) return fallo("Sesión expirada. Volvé a iniciar sesión.");

  const validacionFecha = validarFechaPartido(input.fechaHora);
  if (!validacionFecha.ok) return fallo(validacionFecha.error);
  const fecha = new Date(input.fechaHora);

  const cupo = Number(input.cantidadJugadores);
  if (!Number.isInteger(cupo) || cupo < 2 || cupo > 30) {
    return fallo("Cantidad de jugadores inválida");
  }

  const costo = Number(input.costoTotal);
  if (!Number.isFinite(costo) || costo <= 0 || costo > 99_999_999) {
    return fallo("El costo total debe ser un número válido");
  }

  const supabase = await createClient();

  // Reintentar ante colisión de slug en vez de escupir el error crudo de Postgres.
  for (let intento = 0; intento < 5; intento++) {
    const { data, error } = await supabase
      .from("partidos")
      .insert({
        organizador_id: userId,
        fecha_hora: fecha.toISOString(),
        cantidad_jugadores: cupo,
        costo_total: costo,
        link_slug: generarSlug(),
        estado: "abierto",
      })
      .select("id")
      .single();

    if (!error) {
      revalidatePath("/organizador");
      return { ok: true as const, data: { id: data.id as string } };
    }
    if (error.code !== "23505") return falloDe("crearPartido", error);
  }

  return fallo("No se pudo generar un link único. Probá de nuevo.");
}

async function cambiarEstado(partidoId: string, estado: "abierto" | "cerrado") {
  if (!esUuid(partidoId)) return fallo("Partido inválido");

  const userId = await organizadorActual();
  if (!userId) return fallo("Sesión expirada. Volvé a iniciar sesión.");

  const supabase = await createClient();

  // RLS ya limita el UPDATE al dueño. Si no es suyo, no toca ninguna fila.
  const { data, error } = await supabase
    .from("partidos")
    .update({ estado })
    .eq("id", partidoId)
    .select("id");

  if (error) return falloDe("cambiarEstado", error);
  if (!data || data.length === 0) {
    return fallo("No tenés permiso sobre este partido");
  }

  revalidatePath(`/organizador/${partidoId}`);
  return { ok: true as const };
}

export async function cerrarPartido(partidoId: string) {
  return cambiarEstado(partidoId, "cerrado");
}

export async function reabrirPartido(partidoId: string) {
  return cambiarEstado(partidoId, "abierto");
}

/** Carga o corrige el resultado final. Sólo el organizador; RLS ya lo limita a su propio partido. */
export async function guardarResultado(
  partidoId: string,
  team1: number,
  team2: number,
) {
  if (!esUuid(partidoId)) return fallo("Partido inválido");

  const validacion = validarResultado(team1, team2);
  if (!validacion.ok) return fallo(validacion.error);

  const userId = await organizadorActual();
  if (!userId) return fallo("Sesión expirada. Volvé a iniciar sesión.");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("partidos")
    .update({
      resultado_team1: validacion.team1,
      resultado_team2: validacion.team2,
    })
    .eq("id", partidoId)
    .select("id");

  if (error) return falloDe("guardarResultado", error);
  if (!data || data.length === 0) {
    return fallo("No tenés permiso sobre este partido");
  }

  revalidatePath(`/organizador/${partidoId}`);
  return { ok: true as const };
}

/** Borra un partido ya jugado, sin dejar residuos ni en la base ni en Storage. */
export async function eliminarPartido(partidoId: string) {
  if (!esUuid(partidoId)) return fallo("Partido inválido");

  const userId = await organizadorActual();
  if (!userId) return fallo("Sesión expirada. Volvé a iniciar sesión.");

  const supabase = await createClient();
  const res = await eliminarPartidoConResiduos(supabase, partidoId);

  if (!res.ok) {
    switch (res.motivo) {
      case "todavia_no_jugado":
        return fallo("Solo se puede eliminar un partido después de jugado");
      case "sin_permiso":
        return fallo("No tenés permiso para eliminar este partido");
      default:
        return falloDe(`eliminarPartido/${res.motivo}`, res.causa);
    }
  }

  revalidatePath("/organizador");
  return { ok: true as const };
}
