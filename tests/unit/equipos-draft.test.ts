import { describe, expect, it } from "vitest";

import {
  aplicarDraftEquipo,
  contarEquipos,
  moverEnDraft,
  obtenerCambiosEquipo,
  reconciliarDraftEquipo,
  type EquipoDraft,
} from "@/lib/equipos-draft";
import type { Equipo } from "@/lib/db/types";
import {
  normalizarCambiosParaGuardar,
  normalizarRosterVersion,
} from "@/lib/equipos-payload";

type Ficha = { id: string; nombre: string; equipo: Equipo };

const jugadores: Ficha[] = [
  { id: "a", nombre: "Ana", equipo: "team1" },
  { id: "b", nombre: "Beto", equipo: "team2" },
  { id: "c", nombre: "Caro", equipo: null },
];

describe("draft local de equipos", () => {
  it("aplica movimientos sin mutar el snapshot recibido", () => {
    const draft: EquipoDraft = { c: "team1" };
    const efectivos = aplicarDraftEquipo(jugadores, draft);

    expect(efectivos.map(({ id, equipo }) => ({ id, equipo }))).toEqual([
      { id: "a", equipo: "team1" },
      { id: "b", equipo: "team2" },
      { id: "c", equipo: "team1" },
    ]);
    expect(jugadores[2].equipo).toBeNull();
  });

  it("elimina el delta cuando el jugador vuelve a su equipo guardado", () => {
    const ida = moverEnDraft(jugadores, {}, "a", "team2", 4);
    expect(ida).toEqual({ ok: true, draft: { a: "team2" } });
    if (!ida.ok) throw new Error("movimiento inesperadamente inválido");

    const vuelta = moverEnDraft(jugadores, ida.draft, "a", "team1", 4);

    expect(vuelta).toEqual({ ok: true, draft: {} });
    if (!vuelta.ok) throw new Error("movimiento inesperadamente inválido");
    expect(obtenerCambiosEquipo(jugadores, vuelta.draft)).toEqual([]);
  });

  it("valida los cupos contra el estado efectivo, no contra el snapshot", () => {
    const primerMovimiento = moverEnDraft(jugadores, {}, "c", "team1", 4);
    if (!primerMovimiento.ok) throw new Error("primer movimiento inválido");

    const equipoLleno = moverEnDraft(
      jugadores,
      primerMovimiento.draft,
      "b",
      "team1",
      4,
    );

    expect(equipoLleno).toEqual({ ok: false, error: "El equipo 1 está completo" });
    expect(contarEquipos(aplicarDraftEquipo(jugadores, primerMovimiento.draft))).toEqual({
      team1: 2,
      team2: 1,
      reserva: 0,
    });
  });

  it("reconcilia recargas: conserva cambios válidos, suma altas y quita bajas", () => {
    const recargados: Ficha[] = [
      { id: "a", nombre: "Ana", equipo: "team1" },
      { id: "c", nombre: "Caro", equipo: null },
      { id: "d", nombre: "Dani", equipo: null },
    ];

    expect(reconciliarDraftEquipo(recargados, { a: "team2", b: null, c: "team1" })).toEqual({
      a: "team2",
      c: "team1",
    });
  });

  it("quita un override cuando la base ya alcanzó el valor local", () => {
    const recargados: Ficha[] = [
      { id: "a", nombre: "Ana", equipo: "team2" },
      { id: "b", nombre: "Beto", equipo: "team2" },
    ];

    expect(reconciliarDraftEquipo(recargados, { a: "team2" })).toEqual({});
  });

  it("genera un payload mínimo: sólo ids existentes con cambios reales", () => {
    expect(
      obtenerCambiosEquipo(jugadores, {
        a: "team1",
        b: null,
        inexistente: "team2",
      }),
    ).toEqual([{ jugadorId: "b", equipo: null }]);
  });

  it("en cupos impares usa ceil por equipo sin superar el cupo total", () => {
    const impares: Ficha[] = [
      { id: "a", nombre: "A", equipo: "team1" },
      { id: "b", nombre: "B", equipo: "team1" },
      { id: "c", nombre: "C", equipo: "team2" },
      { id: "d", nombre: "D", equipo: "team2" },
      { id: "e", nombre: "E", equipo: null },
      { id: "f", nombre: "F", equipo: null },
    ];

    const quinto = moverEnDraft(impares, {}, "e", "team1", 5);
    expect(quinto.ok).toBe(true);
    if (!quinto.ok) throw new Error("quinto jugador inválido");

    expect(moverEnDraft(impares, quinto.draft, "f", "team2", 5)).toEqual({
      ok: false,
      error: "El plantel supera el cupo del partido",
    });
  });
});

describe("payload batch de equipos", () => {
  it("normaliza UUID antes de detectar duplicados por casing", () => {
    const uuid = "367b8a55-3d88-4688-afc2-66336d3c6777";

    expect(
      normalizarCambiosParaGuardar([
        { jugadorId: uuid.toUpperCase(), equipo: "team1" },
        { jugadorId: uuid, equipo: "team2" },
      ]),
    ).toEqual({ ok: false, error: "Hay jugadores repetidos en los cambios" });
  });

  it("rechaza UUID inválidos con un error controlado", () => {
    expect(
      normalizarCambiosParaGuardar([
        { jugadorId: "no-es-un-uuid", equipo: "team1" },
      ]),
    ).toEqual({ ok: false, error: "Los cambios de equipos son inválidos" });
  });

  it("devuelve UUID canónicos y equipos tipados", () => {
    expect(
      normalizarCambiosParaGuardar([
        {
          jugadorId: "367B8A55-3D88-4688-AFC2-66336D3C6777",
          equipo: null,
        },
      ]),
    ).toEqual({
      ok: true,
      cambios: [
        {
          jugadorId: "367b8a55-3d88-4688-afc2-66336d3c6777",
          equipo: null,
        },
      ],
    });
  });
  it("acepta únicamente una versión de roster entera, segura y no negativa", () => {
    expect(normalizarRosterVersion(0)).toEqual({ ok: true, version: 0 });
    expect(normalizarRosterVersion(42)).toEqual({ ok: true, version: 42 });

    for (const version of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "4", null]) {
      expect(normalizarRosterVersion(version)).toEqual({
        ok: false,
        error: "La versión del plantel es inválida",
      });
    }
  });
});
