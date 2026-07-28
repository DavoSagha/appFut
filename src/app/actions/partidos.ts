"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { esUuid, fallo, falloDe, organizadorActual } from "@/lib/auth-guard";
import { generarSlug } from "@/lib/validaciones";

export async function crearPartido(input: {
  fechaHora: string;
  cantidadJugadores: number;
  costoTotal: number;
}) {
  const userId = await organizadorActual();
  if (!userId) return fallo("Sesión expirada. Volvé a iniciar sesión.");

  const fecha = new Date(input.fechaHora);
  if (Number.isNaN(fecha.getTime())) return fallo("Fecha u hora inválida");

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
