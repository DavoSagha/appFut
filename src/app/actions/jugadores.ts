"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { esSlug, esUuid, fallo, falloDe, usuarioActual } from "@/lib/auth-guard";
import { EMOJIS, NOMBRE_MAX_LARGO } from "@/lib/constants";
import type { PagoEstado, PartidoEstado, JugadorRol } from "@/lib/db/types";

export type JugadorPublico = {
  id: string;
  nombre: string;
  rol: JugadorRol;
  emoji: string | null;
  pagoEstado: PagoEstado | null;
};

export type VistaPartido = {
  partido: {
    id: string;
    fechaHora: string;
    cantidadJugadores: number;
    estado: PartidoEstado;
    slug: string;
  };
  jugadores: JugadorPublico[];
  yo: {
    id: string;
    nombre: string;
    rol: JugadorRol;
    emoji: string | null;
    montoEsperado: number;
    pagoEstado: PagoEstado;
    tieneComprobante: boolean;
  } | null;
};

type FilaPartido = {
  id: string;
  fecha_hora: string;
  cantidad_jugadores: number;
  estado: PartidoEstado;
};

type FilaRoster = {
  id: string;
  nombre: string;
  rol: JugadorRol;
  emoji_o_color: string | null;
  pago_estado: PagoEstado | null;
  es_mio: boolean;
};

/**
 * Vista de un partido resuelta por slug.
 * Pasa por funciones SECURITY DEFINER: el slug es la credencial de invitación,
 * así nadie enumera la tabla `partidos` como se podía antes.
 */
export async function obtenerVistaPartido(slug: string) {
  if (!esSlug(slug)) return fallo("Link inválido");

  const supabase = await createClient();

  const { data: rawPartido, error: errPartido } = await supabase.rpc(
    "partido_por_slug",
    { p_slug: slug }
  );

  if (errPartido) return falloDe("obtenerVistaPartido/partido", errPartido);

  const p = (rawPartido as FilaPartido[] | null)?.[0];
  if (!p) return fallo("Partido no encontrado");

  const { data: rawRoster, error: errRoster } = await supabase.rpc(
    "roster_por_slug",
    { p_slug: slug }
  );

  if (errRoster) return falloDe("obtenerVistaPartido/roster", errRoster);

  const todos = (rawRoster as FilaRoster[] | null) ?? [];
  const mio = todos.find((j) => j.es_mio);

  let yo: VistaPartido["yo"] = null;
  if (mio) {
    const { data: pago } = await supabase
      .from("pagos")
      .select("estado, monto_esperado, comprobante_url")
      .eq("jugador_id", mio.id)
      .single();

    yo = {
      id: mio.id,
      nombre: mio.nombre,
      rol: mio.rol,
      emoji: mio.emoji_o_color,
      montoEsperado: pago?.monto_esperado ?? 0,
      pagoEstado: (pago?.estado as PagoEstado) ?? "sin_declarar",
      tieneComprobante: Boolean(pago?.comprobante_url),
    };
  }

  const vista: VistaPartido = {
    partido: {
      id: p.id,
      fechaHora: p.fecha_hora,
      cantidadJugadores: p.cantidad_jugadores,
      estado: p.estado,
      slug,
    },
    jugadores: todos.map((j) => ({
      id: j.id,
      nombre: j.nombre,
      rol: j.rol,
      emoji: j.emoji_o_color,
      pagoEstado: j.pago_estado,
    })),
    yo,
  };

  return { ok: true as const, data: vista };
}

export async function unirsePartido(slug: string, nombreCrudo: string) {
  if (!esSlug(slug)) return fallo("Link inválido");

  const nombre = String(nombreCrudo ?? "").trim().replace(/\s+/g, " ");
  if (nombre.length < 2) return fallo("Escribí tu nombre");
  if (nombre.length > NOMBRE_MAX_LARGO) return fallo("El nombre es demasiado largo");

  const usuario = await usuarioActual();
  if (!usuario) return fallo("No se pudo iniciar la sesión. Recargá la página.");

  const supabase = await createClient();

  const { data: rawPartido } = await supabase.rpc("partido_por_slug", {
    p_slug: slug,
  });

  const p = (rawPartido as FilaPartido[] | null)?.[0];
  if (!p) return fallo("Partido no encontrado");
  if (p.estado === "cerrado") return fallo("Este partido ya está cerrado");

  const { error } = await supabase
    .from("jugadores")
    .insert({ partido_id: p.id, nombre, user_id: usuario.id });

  if (error) {
    // UNIQUE(partido_id, user_id): ya estás anotado en este partido.
    if (error.code === "23505") {
      revalidatePath(`/p/${slug}`);
      return { ok: true as const };
    }
    if (error.message.includes("cerrado")) {
      return fallo("Este partido ya está cerrado");
    }
    return falloDe("unirsePartido", error);
  }

  revalidatePath(`/p/${slug}`);
  return { ok: true as const };
}

export async function elegirEmoji(slug: string, emoji: string) {
  if (!esSlug(slug)) return fallo("Link inválido");
  if (!(EMOJIS as readonly string[]).includes(emoji)) return fallo("Emoji inválido");

  const usuario = await usuarioActual();
  if (!usuario) return fallo("No estás anotado en este partido");

  const supabase = await createClient();

  // RLS limita el UPDATE a la ficha propia; el trigger impide tocar el rol.
  const { data, error } = await supabase
    .from("jugadores")
    .update({ emoji_o_color: emoji })
    .eq("user_id", usuario.id)
    .select("id, partido_id");

  if (error) return falloDe("elegirEmoji", error);
  if (!data || data.length === 0) return fallo("No estás anotado en este partido");

  revalidatePath(`/p/${slug}`);
  return { ok: true as const };
}

export async function darseDeBaja(slug: string) {
  if (!esSlug(slug)) return fallo("Link inválido");

  const usuario = await usuarioActual();
  if (!usuario) return fallo("No estás anotado en este partido");

  const supabase = await createClient();

  const { data: rawPartido } = await supabase.rpc("partido_por_slug", {
    p_slug: slug,
  });

  const p = (rawPartido as FilaPartido[] | null)?.[0];
  if (!p) return fallo("Partido no encontrado");

  const { error } = await supabase
    .from("jugadores")
    .delete()
    .eq("partido_id", p.id)
    .eq("user_id", usuario.id);

  if (error) return falloDe("darseDeBaja", error);

  revalidatePath(`/p/${slug}`);
  return { ok: true as const };
}

/** Baja hecha por el organizador desde su dashboard. */
export async function eliminarJugador(jugadorId: string) {
  if (!esUuid(jugadorId)) return fallo("Jugador inválido");

  const supabase = await createClient();

  const { data: jugador } = await supabase
    .from("jugadores")
    .select("partido_id")
    .eq("id", jugadorId)
    .single();

  if (!jugador) return fallo("No tenés permiso sobre este jugador");

  // RLS deja borrar solo si sos el dueño de la ficha o el organizador.
  const { data, error } = await supabase
    .from("jugadores")
    .delete()
    .eq("id", jugadorId)
    .select("id");

  if (error) return falloDe("eliminarJugador", error);
  if (!data || data.length === 0) {
    return fallo("No tenés permiso sobre este jugador");
  }

  revalidatePath(`/organizador/${jugador.partido_id}`);
  return { ok: true as const };
}
