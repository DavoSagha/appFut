"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  esSlug,
  esUuid,
  fallo,
  falloDe,
  normalizarNombre,
  organizadorActual,
  usuarioActual,
} from "@/lib/auth-guard";
import { EMOJIS, NOMBRE_MAX_LARGO } from "@/lib/constants";
import type { PagoEstado, PartidoEstado, JugadorRol, Equipo } from "@/lib/db/types";

export type JugadorPublico = {
  id: string;
  nombre: string;
  rol: JugadorRol;
  equipo: Equipo;
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
    equipo: Equipo;
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
  equipo: Equipo | null;
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
      equipo: mio.equipo ?? null,
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
      equipo: j.equipo ?? null,
      emoji: j.emoji_o_color,
      pagoEstado: j.pago_estado,
    })),
    yo,
  };

  return { ok: true as const, data: vista };
}

export type AccionUnirse =
  | "creada"
  | "reclamada"
  | "reclamada_libre"
  | "ya_estabas";

/** Une al jugador, o le devuelve su ficha si perdió la sesión anónima. */
export async function unirsePartido(slug: string, nombreCrudo: string) {
  if (!esSlug(slug)) return fallo("Link inválido");

  const nombre = normalizarNombre(nombreCrudo);
  if (nombre.length < 2) return fallo("Escribí tu nombre");
  if (nombre.length > NOMBRE_MAX_LARGO) return fallo("El nombre es demasiado largo");

  const usuario = await usuarioActual();
  if (!usuario) return fallo("No se pudo iniciar la sesión. Recargá la página.");

  const supabase = await createClient();

  // Todo el chequeo + el UPDATE ocurren atómicos y bajo advisory lock dentro
  // de unirse_o_reclamar(). Va por SECURITY DEFINER a propósito: el que
  // reclama todavía NO es jugador del partido, así que RLS no lo deja ni leer
  // la ficha. La alternativa era aflojar la policy — que es exactamente cómo
  // se rompió la seguridad la primera vez.
  const { data, error } = await supabase.rpc("unirse_o_reclamar", {
    p_slug: slug,
    p_nombre: nombre,
  });

  if (error) {
    // P0001 = RAISE EXCEPTION de plpgsql: son mensajes nuestros, ya redactados
    // para el usuario. Cualquier otro código es un problema real.
    if (error.code === "P0001") return fallo(error.message);
    return falloDe("unirsePartido", error);
  }

  const fila = (data as { jugador_id: string; accion: AccionUnirse }[] | null)?.[0];

  revalidatePath(`/p/${slug}`);
  return { ok: true as const, data: { accion: fila?.accion ?? "creada" } };
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

export async function agregarJugador(partidoId: string, nombreCrudo: string) {
  if (!esUuid(partidoId)) return fallo("Partido inválido");

  const nombre = String(nombreCrudo ?? "").trim().replace(/\s+/g, " ");
  if (nombre.length < 2) return fallo("Escribí el nombre");
  if (nombre.length > NOMBRE_MAX_LARGO) return fallo("El nombre es demasiado largo");

  const userId = await organizadorActual();
  if (!userId) return fallo("Sesión expirada. Volvé a iniciar sesión.");

  const supabase = await createClient();

  // user_id NULL: la ficha queda SIN dueño. El jugador la reclama después
  // escribiendo su nombre, y así el organizador no queda dueño de N fichas
  // (que además chocarían contra el índice único (partido_id, user_id)).
  const { error } = await supabase
    .from("jugadores")
    .insert({ partido_id: partidoId, nombre, user_id: null });

  if (error) {
    if (error.code === "23505") return fallo("Ya hay un jugador con ese nombre");
    if (error.message.includes("cerrado")) return fallo("El partido está cerrado");
    return falloDe("agregarJugador", error);
  }

  revalidatePath(`/organizador/${partidoId}`);
  return { ok: true as const };
}

/** Un jugador elige a qué equipo unirse, o vuelve a reserva. */
export async function cambiarEquipo(slug: string, equipo: "team1" | "team2" | null) {
  if (!esSlug(slug)) return fallo("Link inválido");

  const usuario = await usuarioActual();
  if (!usuario) return fallo("No estás anotado en este partido");

  const supabase = await createClient();

  const { data: rawPartido } = await supabase.rpc("partido_por_slug", {
    p_slug: slug,
  });

  const p = (rawPartido as { id: string; cantidad_jugadores: number }[] | null)?.[0];
  if (!p) return fallo("Partido no encontrado");

  const jugadorActual = await supabase
    .from("jugadores")
    .select("id, equipo, user_id")
    .eq("partido_id", p.id)
    .eq("user_id", usuario.id)
    .single();

  if (!jugadorActual.data) return fallo("No estás anotado en este partido");

  // Si está eligiendo un equipo, verificar cupo
  if (equipo) {
    const maxPorEquipo = p.cantidad_jugadores / 2;
    const { count } = await supabase
      .from("jugadores")
      .select("id", { count: "exact", head: true })
      .eq("partido_id", p.id)
      .eq("equipo", equipo);

    if (count !== null && count >= maxPorEquipo) {
      return fallo(`El equipo ${equipo === "team1" ? "1" : "2"} está completo`);
    }
  }

  const nuevoRol = equipo ? "titular" : "suplente";
  const { error } = await supabase
    .from("jugadores")
    .update({ equipo, rol: nuevoRol })
    .eq("id", jugadorActual.data.id);

  if (error) return falloDe("cambiarEquipo", error);

  revalidatePath(`/p/${slug}`);
  return { ok: true as const };
}

/** El organizador mueve a cualquier jugador a un equipo o a reserva. */
export async function moverJugador(jugadorId: string, equipo: "team1" | "team2" | null) {
  if (!esUuid(jugadorId)) return fallo("Jugador inválido");

  const userId = await organizadorActual();
  if (!userId) return fallo("Sesión expirada. Volvé a iniciar sesión.");

  const supabase = await createClient();

  const jugador = await supabase
    .from("jugadores")
    .select("id, partido_id, equipo")
    .eq("id", jugadorId)
    .single();

  if (!jugador.data) return fallo("Jugador no encontrado");

  const { data: partido } = await supabase
    .from("partidos")
    .select("cantidad_jugadores")
    .eq("id", jugador.data.partido_id)
    .single();

  if (!partido) return fallo("Partido no encontrado");

  if (equipo) {
    const maxPorEquipo = partido.cantidad_jugadores / 2;
    const { count } = await supabase
      .from("jugadores")
      .select("id", { count: "exact", head: true })
      .eq("partido_id", jugador.data.partido_id)
      .eq("equipo", equipo);

    if (count !== null && count >= maxPorEquipo) {
      return fallo(`El equipo ${equipo === "team1" ? "1" : "2"} está completo`);
    }
  }

  const nuevoRol = equipo ? "titular" : "suplente";
  const { error } = await supabase
    .from("jugadores")
    .update({ equipo, rol: nuevoRol })
    .eq("id", jugadorId);

  if (error) return falloDe("moverJugador", error);

  revalidatePath(`/organizador/${jugador.data.partido_id}`);
  return { ok: true as const };
}
