import type { Equipo } from "@/lib/db/types";

export type JugadorConEquipo = {
  id: string;
  equipo: Equipo;
};

export type EquipoDraft = Readonly<Record<string, Equipo>>;

export type CambioEquipo = {
  jugadorId: string;
  equipo: Equipo;
};

type ResultadoMovimiento =
  | { ok: true; draft: EquipoDraft }
  | { ok: false; error: string };

const tieneOverride = (draft: EquipoDraft, jugadorId: string) =>
  Object.prototype.hasOwnProperty.call(draft, jugadorId);

export function aplicarDraftEquipo<T extends JugadorConEquipo>(
  jugadores: readonly T[],
  draft: EquipoDraft,
): T[] {
  return jugadores.map((jugador) =>
    tieneOverride(draft, jugador.id)
      ? { ...jugador, equipo: draft[jugador.id] }
      : jugador,
  );
}

export function contarEquipos(jugadores: readonly JugadorConEquipo[]) {
  return jugadores.reduce(
    (conteo, jugador) => {
      if (jugador.equipo === "team1") conteo.team1 += 1;
      else if (jugador.equipo === "team2") conteo.team2 += 1;
      else conteo.reserva += 1;
      return conteo;
    },
    { team1: 0, team2: 0, reserva: 0 },
  );
}

export function moverEnDraft(
  jugadores: readonly JugadorConEquipo[],
  draft: EquipoDraft,
  jugadorId: string,
  equipo: Equipo,
  cantidadJugadores: number,
): ResultadoMovimiento {
  const jugadorGuardado = jugadores.find((jugador) => jugador.id === jugadorId);
  if (!jugadorGuardado) return { ok: false, error: "Jugador no encontrado" };

  const efectivos = aplicarDraftEquipo(jugadores, draft);
  const jugadorEfectivo = efectivos.find((jugador) => jugador.id === jugadorId);

  if (equipo && jugadorEfectivo?.equipo !== equipo) {
    const cupos = contarEquipos(efectivos);
    const maxPorEquipo = Math.ceil(cantidadJugadores / 2);
    if (cupos[equipo] >= maxPorEquipo) {
      return {
        ok: false,
        error: `El equipo ${equipo === "team1" ? "1" : "2"} está completo`,
      };
    }

    const titulares = cupos.team1 + cupos.team2;
    if (!jugadorEfectivo?.equipo && titulares >= cantidadJugadores) {
      return { ok: false, error: "El plantel supera el cupo del partido" };
    }
  }

  const siguiente = { ...draft };
  if (jugadorGuardado.equipo === equipo) delete siguiente[jugadorId];
  else siguiente[jugadorId] = equipo;

  return { ok: true, draft: siguiente };
}

export function reconciliarDraftEquipo(
  jugadores: readonly JugadorConEquipo[],
  draft: EquipoDraft,
): EquipoDraft {
  const siguiente: Record<string, Equipo> = {};

  for (const jugador of jugadores) {
    if (
      tieneOverride(draft, jugador.id) &&
      draft[jugador.id] !== jugador.equipo
    ) {
      siguiente[jugador.id] = draft[jugador.id];
    }
  }

  return siguiente;
}

export function obtenerCambiosEquipo(
  jugadores: readonly JugadorConEquipo[],
  draft: EquipoDraft,
): CambioEquipo[] {
  const cambios: CambioEquipo[] = [];

  for (const jugador of jugadores) {
    if (
      tieneOverride(draft, jugador.id) &&
      draft[jugador.id] !== jugador.equipo
    ) {
      cambios.push({ jugadorId: jugador.id, equipo: draft[jugador.id] });
    }
  }

  return cambios;
}
