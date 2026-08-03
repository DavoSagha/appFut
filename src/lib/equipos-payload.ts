import type { Equipo } from "@/lib/db/types";
import { esUuid } from "@/lib/validaciones";

export type CambioEquipoNormalizado = {
  jugadorId: string;
  equipo: Equipo;
};

type ResultadoCambios =
  | { ok: true; cambios: CambioEquipoNormalizado[] }
  | { ok: false; error: string };

export function normalizarCambiosParaGuardar(cambios: unknown): ResultadoCambios {
  if (!Array.isArray(cambios) || cambios.length > 500) {
    return { ok: false, error: "Los cambios de equipos son inválidos" };
  }

  const ids = new Set<string>();
  const normalizados: CambioEquipoNormalizado[] = [];

  for (const valor of cambios) {
    if (!valor || typeof valor !== "object") {
      return { ok: false, error: "Los cambios de equipos son inválidos" };
    }

    const cambio = valor as Record<string, unknown>;
    const jugadorId = cambio.jugadorId;
    const equipo = cambio.equipo;
    if (
      !esUuid(jugadorId) ||
      (equipo !== "team1" && equipo !== "team2" && equipo !== null)
    ) {
      return { ok: false, error: "Los cambios de equipos son inválidos" };
    }

    const jugadorIdCanonico = jugadorId.toLowerCase();
    if (ids.has(jugadorIdCanonico)) {
      return { ok: false, error: "Hay jugadores repetidos en los cambios" };
    }

    ids.add(jugadorIdCanonico);
    normalizados.push({ jugadorId: jugadorIdCanonico, equipo });
  }

  return { ok: true, cambios: normalizados };
}

type ResultadoRosterVersion =
  | { ok: true; version: number }
  | { ok: false; error: string };

export function normalizarRosterVersion(version: unknown): ResultadoRosterVersion {
  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 0
  ) {
    return { ok: false, error: "La versión del plantel es inválida" };
  }

  return { ok: true, version };
}