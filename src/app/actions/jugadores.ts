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
import {
  normalizarCambiosParaGuardar,
  normalizarRosterVersion,
} from "@/lib/equipos-payload";

export type CambioEquipoJugador = {
  jugadorId: string;
  equipo: Equipo;
};

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
    resultadoTeam1: number | null;
    resultadoTeam2: number | null;
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
  resultado_team1: number | null;
  resultado_team2: number | null;
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
      resultadoTeam1: p.resultado_team1,
      resultadoTeam2: p.resultado_team2,
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

export type ResumenUnirse = {
  partido: {
    fechaHora: string;
    cantidadJugadores: number;
    estado: PartidoEstado;
  };
  anotados: number;
  yaUnido: boolean;
};

/**
 * Versión pública y liviana para `/unirse/[slug]`: NO trae roster_por_slug.
 * Antes de unirse, nadie tiene que ver los nombres de Team1/Team2/Reserva
 * -sólo lo necesario para decidir si unirse (y si ya se está adentro, para
 * redirigir a la vista propia).
 */
export async function obtenerResumenUnirse(slug: string) {
  if (!esSlug(slug)) return fallo("Link inválido");

  const supabase = await createClient();

  const { data: rawPartido, error: errPartido } = await supabase.rpc(
    "partido_por_slug",
    { p_slug: slug }
  );

  if (errPartido) return falloDe("obtenerResumenUnirse/partido", errPartido);

  const p = (rawPartido as FilaPartido[] | null)?.[0];
  if (!p) return fallo("Partido no encontrado");

  const { data: rawResumen, error: errResumen } = await supabase.rpc(
    "resumen_publico_por_slug",
    { p_slug: slug }
  );

  if (errResumen) return falloDe("obtenerResumenUnirse/resumen", errResumen);

  const r = (rawResumen as { anotados: number; ya_estoy: boolean }[] | null)?.[0];

  const resumen: ResumenUnirse = {
    partido: {
      fechaHora: p.fecha_hora,
      cantidadJugadores: p.cantidad_jugadores,
      estado: p.estado,
    },
    anotados: r?.anotados ?? 0,
    yaUnido: r?.ya_estoy ?? false,
  };

  return { ok: true as const, data: resumen };
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

  const nombre = normalizarNombre(nombreCrudo);
  if (nombre.length < 2) return fallo("Escribí el nombre");
  if (nombre.length > NOMBRE_MAX_LARGO) return fallo("El nombre es demasiado largo");

  const userId = await organizadorActual();
  if (!userId) return fallo("Sesión expirada. Volvé a iniciar sesión.");

  const supabase = await createClient();

  // user_id NULL: la ficha queda SIN dueño. El jugador la reclama después
  // escribiendo su nombre, y así el organizador no queda dueño de N fichas
  // (que además chocarían contra el índice único (partido_id, user_id)).
  // El índice único (partido_id, lower(nombre)) es quien realmente evita la
  // condición de carrera: dos altas simultáneas con el mismo nombre no
  // pueden pasar las dos, sin importar qué validó el cliente antes.
  const { error } = await supabase
    .from("jugadores")
    .insert({ partido_id: partidoId, nombre, user_id: null });

  if (error) {
    if (error.code === "23505") return fallo("Cambia el nombre");
    if (error.message.includes("cerrado")) return fallo("El partido está cerrado");
    return falloDe("agregarJugador", error);
  }

  revalidatePath(`/organizador/${partidoId}`);
  return { ok: true as const };
}

/** Un jugador elige a qué equipo unirse, o vuelve a reserva. */
export async function cambiarEquipo(slug: string, equipo: Equipo) {
  if (!esSlug(slug)) return fallo("Link inválido");
  if (equipo !== "team1" && equipo !== "team2" && equipo !== null) {
    return fallo("Equipo inválido");
  }

  const usuario = await usuarioActual();
  if (!usuario) return fallo("No estás anotado en este partido");

  const supabase = await createClient();
  const { error } = await supabase.rpc("cambiar_equipo_propio", {
    p_slug: slug,
    p_equipo: equipo,
  });

  if (error) {
    if (error.code === "P0001") return fallo(error.message);
    return falloDe("cambiarEquipo", error);
  }

  revalidatePath(`/p/${slug}`);
  return { ok: true as const };
}
/** Único acceso de escritura para movimientos del organizador. */
async function actualizar_equipos_batch(
  partidoId: string,
  cambios: unknown,
  rosterVersion: unknown,
) {
  if (!esUuid(partidoId)) return fallo("Partido inválido");

  const validacion = normalizarCambiosParaGuardar(cambios);
  if (!validacion.ok) return fallo(validacion.error);

  const validacionVersion = normalizarRosterVersion(rosterVersion);
  if (!validacionVersion.ok) return fallo(validacionVersion.error);

  if (validacion.cambios.length === 0) {
    return {
      ok: true as const,
      data: { rosterVersion: validacionVersion.version },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardar_equipos_partido", {
    p_partido_id: partidoId,
    p_cambios: validacion.cambios.map((cambio) => ({
      jugador_id: cambio.jugadorId,
      equipo: cambio.equipo,
    })),
    p_expected_version: validacionVersion.version,
  });

  if (error) {
    if (error.code === "P0001" && error.message.includes("ROSTER_STALE")) {
      return {
        ok: false as const,
        error:
          "El plantel cambió mientras editabas. Actualizamos la lista: revisá tus cambios pendientes y confirmá de nuevo.",
        stale: true as const,
      };
    }
    if (error.code === "P0001") return fallo(error.message);
    return falloDe("actualizar_equipos_batch", error);
  }

  const nuevaVersion = normalizarRosterVersion(data);
  if (!nuevaVersion.ok) {
    return fallo("No se pudo verificar la versión guardada del plantel");
  }

  return {
    ok: true as const,
    data: { rosterVersion: nuevaVersion.version },
  };
}

/** Compatibilidad: mueve uno usando la misma transacción batch. */
export async function moverJugador(jugadorId: string, equipo: Equipo) {
  if (!esUuid(jugadorId)) return fallo("Jugador inválido");
  if (equipo !== "team1" && equipo !== "team2" && equipo !== null) {
    return fallo("Equipo inválido");
  }

  const userId = await organizadorActual();
  if (!userId) return fallo("Sesión expirada. Volvé a iniciar sesión.");

  const supabase = await createClient();
  const { data: jugador, error } = await supabase
    .from("jugadores")
    .select("partido_id")
    .eq("id", jugadorId)
    .single();

  if (error || !jugador) return fallo("Jugador no encontrado");

  const { data: partido, error: errorPartido } = await supabase
    .from("partidos")
    .select("roster_version")
    .eq("id", jugador.partido_id)
    .single();

  if (errorPartido || !partido) return fallo("Partido no encontrado");

  const resultado = await actualizar_equipos_batch(
    jugador.partido_id,
    [{ jugadorId, equipo }],
    partido.roster_version,
  );
  if (!resultado.ok) return resultado;

  revalidatePath("/organizador/" + jugador.partido_id);
  return resultado;
}

/** Guarda el draft completo del organizador en una sola transacción. */
export async function guardarCambiosEquipos(
  partidoId: string,
  cambios: readonly CambioEquipoJugador[],
  rosterVersion: number,
) {
  if (!esUuid(partidoId)) return fallo("Partido inválido");

  const userId = await organizadorActual();
  if (!userId) return fallo("Sesión expirada. Volvé a iniciar sesión.");

  const resultado = await actualizar_equipos_batch(
    partidoId,
    cambios,
    rosterVersion,
  );
  if (!resultado.ok) return resultado;

  revalidatePath("/organizador/" + partidoId);
  return resultado;
}
