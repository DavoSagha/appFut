import { describe, it, expect, beforeAll } from "vitest";

import {
  organizador,
  crearPartido,
  anotarse,
  leerFicha,
  leerPago,
  leerPartido,
  admin,
} from "./_entorno";

let org: Awaited<ReturnType<typeof organizador>>;

beforeAll(async () => {
  org = await organizador();
});

async function guardarEquipos(
  partidoId: string,
  cambios: Array<{ jugador_id: string; equipo: "team1" | "team2" | null }>,
) {
  const partido = await leerPartido(partidoId);
  const { error } = await org.cliente.rpc("guardar_equipos_partido", {
    p_partido_id: partidoId,
    p_cambios: cambios,
    p_expected_version: Number(partido?.roster_version),
  });
  if (error) throw new Error(`guardar_equipos_partido falló: ${error.message}`);
}

describe("equipos y roles", () => {
  it("un alta nueva sin equipo entra a Reserva como suplente y no paga", async () => {
    const { id, slug } = await crearPartido({
      organizadorId: org.id,
      cupo: 2,
      costo: 1000,
    });
    const { fichaId, accion } = await anotarse(slug, "Primero");

    expect(accion).toBe("creada");
    expect(await leerFicha(fichaId)).toMatchObject({ rol: "suplente", equipo: null });
    expect(Number((await leerPago(fichaId))?.monto_esperado)).toBe(0);
    expect((await leerPartido(id))?.estado).toBe("abierto");
  });

  it("confirma los equipos de forma atómica y recién entonces completa", async () => {
    const { id, slug } = await crearPartido({
      organizadorId: org.id,
      cupo: 2,
      costo: 1000,
    });
    const uno = await anotarse(slug, "Uno");
    const dos = await anotarse(slug, "Dos");

    await guardarEquipos(id, [
      { jugador_id: uno.fichaId, equipo: "team1" },
      { jugador_id: dos.fichaId, equipo: "team2" },
    ]);

    expect(await leerFicha(uno.fichaId)).toMatchObject({ rol: "titular", equipo: "team1" });
    expect(await leerFicha(dos.fichaId)).toMatchObject({ rol: "titular", equipo: "team2" });
    expect(Number((await leerPago(uno.fichaId))?.monto_esperado)).toBe(500);
    expect(Number((await leerPago(dos.fichaId))?.monto_esperado)).toBe(500);
    expect((await leerPartido(id))?.estado).toBe("completo");
  });

  it("rechaza equipo y rol incompatibles pero permite otras columnas", async () => {
    const { slug } = await crearPartido({ organizadorId: org.id });
    const ficha = await anotarse(slug, "Coherente");

    const invalido = await admin()
      .from("jugadores")
      .update({ rol: "titular" })
      .eq("id", ficha.fichaId);
    expect(invalido.error).toBeTruthy();

    const permitido = await admin()
      .from("jugadores")
      .update({ nombre: "Coherente Editado" })
      .eq("id", ficha.fichaId);
    expect(permitido.error).toBeNull();
  });

  it("cada jugador entra con un orden_ingreso distinto", async () => {
    const { id, slug } = await crearPartido({ organizadorId: org.id, cupo: 4 });
    for (const nombre of ["Ana", "Beto", "Caro", "Dani"]) {
      await anotarse(slug, nombre);
    }

    const { data } = await admin()
      .from("jugadores")
      .select("orden_ingreso")
      .eq("partido_id", id);
    const ordenes = (data ?? []).map((jugador) => jugador.orden_ingreso);
    expect(new Set(ordenes).size).toBe(ordenes.length);
  });

  it("rechaza un snapshot viejo sin pisar un cambio concurrente", async () => {
    const { id, slug } = await crearPartido({
      organizadorId: org.id,
      cupo: 4,
    });
    const primero = await anotarse(slug, "Snapshot Uno");
    const versionLeida = Number((await leerPartido(id))?.roster_version);

    const renombrado = await primero.cliente
      .from("jugadores")
      .update({ nombre: "Snapshot Renombrado" })
      .eq("id", primero.fichaId);
    expect(renombrado.error).toBeNull();
    expect(Number((await leerPartido(id))?.roster_version)).toBe(versionLeida);

    await anotarse(slug, "Cambio Concurrente");
    const { error } = await org.cliente.rpc("guardar_equipos_partido", {
      p_partido_id: id,
      p_cambios: [{ jugador_id: primero.fichaId, equipo: "team1" }],
      p_expected_version: versionLeida,
    });

    expect(error?.message).toContain("ROSTER_STALE");
    expect(await leerFicha(primero.fichaId)).toMatchObject({
      equipo: null,
      rol: "suplente",
    });
  });
});

describe("pagos al confirmar equipos", () => {
  it("recalcula sólo pagos no confirmados cuando cambia el divisor", async () => {
    const { id, slug } = await crearPartido({
      organizadorId: org.id,
      cupo: 4,
      costo: 1200,
    });
    const a = await anotarse(slug, "Ana");
    const b = await anotarse(slug, "Beto");
    await guardarEquipos(id, [
      { jugador_id: a.fichaId, equipo: "team1" },
      { jugador_id: b.fichaId, equipo: "team2" },
    ]);

    await admin()
      .from("pagos")
      .update({ estado: "pendiente_confirmacion" })
      .eq("jugador_id", a.fichaId);
    await admin()
      .from("pagos")
      .update({ estado: "confirmado", confirmado_por: org.id })
      .eq("jugador_id", a.fichaId);

    const c = await anotarse(slug, "Caro");
    await guardarEquipos(id, [{ jugador_id: c.fichaId, equipo: "team1" }]);

    expect(Number((await leerPago(a.fichaId))?.monto_pagado)).toBe(600);
    expect(Number((await leerPago(a.fichaId))?.monto_esperado)).toBe(600);
    expect(Number((await leerPago(b.fichaId))?.monto_esperado)).toBe(400);
    expect(Number((await leerPago(c.fichaId))?.monto_esperado)).toBe(400);
  });
});

describe("baja de un titular", () => {
  it("promueve la primera reserva al equipo liberado", async () => {
    const { id, slug } = await crearPartido({ organizadorId: org.id, cupo: 2 });
    const t1 = await anotarse(slug, "Titular 1");
    const t2 = await anotarse(slug, "Titular 2");
    const reserva = await anotarse(slug, "Reserva");
    await guardarEquipos(id, [
      { jugador_id: t1.fichaId, equipo: "team1" },
      { jugador_id: t2.fichaId, equipo: "team2" },
    ]);

    const { error } = await t1.cliente.from("jugadores").delete().eq("id", t1.fichaId);
    expect(error).toBeNull();
    expect(await leerFicha(reserva.fichaId)).toMatchObject({
      rol: "titular",
      equipo: "team1",
    });
  });
});

describe("partido cerrado", () => {
  it("no se puede entrar", async () => {
    const { id, slug } = await crearPartido({ organizadorId: org.id, cupo: 4 });
    await admin().from("partidos").update({ estado: "cerrado" }).eq("id", id);
    await expect(anotarse(slug, "Tarde")).rejects.toThrow(/cerrado/i);
  });
});
