import { describe, it, expect, beforeAll } from "vitest";

import {
  organizador,
  crearPartido,
  anotarse,
  anonimoSinSesion,
  jugador,
  leerFicha,
  leerPago,
  leerPartido,
  admin,
} from "./_entorno";

/**
 * Cada test de acá es una vulnerabilidad que ya existió en este proyecto.
 * Si alguno se pone verde donde debería fallar, alguien reabrió un agujero.
 * NO se borran ni se relajan sin discutirlo.
 */

let orgId: string;
let orgCliente: Awaited<ReturnType<typeof organizador>>["cliente"];

beforeAll(async () => {
  const org = await organizador();
  orgId = org.id;
  orgCliente = org.cliente;
});

describe("CRÍTICO 1 — anon no tiene acceso directo a las tablas", () => {
  it("no puede enumerar partidos", async () => {
    await crearPartido({ organizadorId: orgId });
    const { data, error } = await anonimoSinSesion()
      .from("partidos")
      .select("id, organizador_id");

    expect(error ?? data?.length === 0).toBeTruthy();
    expect(data ?? []).toHaveLength(0);
  });

  it("no puede leer jugadores", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId });
    await anotarse(slug, "Privado");

    const { data } = await anonimoSinSesion().from("jugadores").select("nombre");
    expect(data ?? []).toHaveLength(0);
  });

  it("no puede leer pagos", async () => {
    const { data } = await anonimoSinSesion().from("pagos").select("monto_esperado");
    expect(data ?? []).toHaveLength(0);
  });

  it("no puede insertarse como jugador salteando la función", async () => {
    const { id } = await crearPartido({ organizadorId: orgId });
    const { error } = await anonimoSinSesion()
      .from("jugadores")
      .insert({ partido_id: id, nombre: "Colado", user_id: null });

    expect(error).toBeTruthy();
  });
});

describe("CRÍTICO — un jugador no puede autoconfirmarse el pago", () => {
  it("no puede pasar su pago a 'confirmado' en un paso", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId, costo: 900 });
    const j = await anotarse(slug, "Vivo");

    const { error } = await j.cliente
      .from("pagos")
      .update({ estado: "confirmado" })
      .eq("jugador_id", j.fichaId);

    expect(error).toBeTruthy();
    expect((await leerPago(j.fichaId))?.estado).not.toBe("confirmado");
  });

  it("no puede hacerlo en dos pasos (el chain de la auditoría original)", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId, costo: 900 });
    const j = await anotarse(slug, "Muy Vivo");

    // Paso 1: declarar el pago. Esto SÍ es legítimo.
    const paso1 = await j.cliente
      .from("pagos")
      .update({ estado: "pendiente_confirmacion" })
      .eq("jugador_id", j.fichaId);
    expect(paso1.error).toBeNull();

    // Paso 2: confirmárselo solo. Acá tiene que morir.
    const paso2 = await j.cliente
      .from("pagos")
      .update({ estado: "confirmado" })
      .eq("jugador_id", j.fichaId);

    expect(paso2.error).toBeTruthy();
    expect((await leerPago(j.fichaId))?.estado).toBe("pendiente_confirmacion");
  });

  it("no puede confirmarse poniendo confirmado_por en null", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId, costo: 900 });
    const j = await anotarse(slug, "Astuto");

    await j.cliente
      .from("pagos")
      .update({ estado: "pendiente_confirmacion" })
      .eq("jugador_id", j.fichaId);

    const { error } = await j.cliente
      .from("pagos")
      .update({ estado: "confirmado", confirmado_por: null })
      .eq("jugador_id", j.fichaId);

    expect(error).toBeTruthy();
    expect((await leerPago(j.fichaId))?.estado).not.toBe("confirmado");
  });

  it("no puede confirmarse haciéndose pasar por el organizador", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId, costo: 900 });
    const j = await anotarse(slug, "Falsificador");

    await j.cliente
      .from("pagos")
      .update({ estado: "pendiente_confirmacion" })
      .eq("jugador_id", j.fichaId);

    const { error } = await j.cliente
      .from("pagos")
      .update({ estado: "confirmado", confirmado_por: orgId })
      .eq("jugador_id", j.fichaId);

    expect(error).toBeTruthy();
    expect((await leerPago(j.fichaId))?.estado).not.toBe("confirmado");
  });
});

describe("RLS no filtra columnas — lo cubren los triggers", () => {
  it("un suplente no puede ascenderse a titular", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId, cupo: 2 });
    await anotarse(slug, "T1");
    await anotarse(slug, "T2");
    const sup = await anotarse(slug, "Ambicioso");

    expect((await leerFicha(sup.fichaId))?.rol).toBe("suplente");

    const { error } = await sup.cliente
      .from("jugadores")
      .update({ rol: "titular" })
      .eq("id", sup.fichaId);

    expect(error).toBeTruthy();
    expect((await leerFicha(sup.fichaId))?.rol).toBe("suplente");
  });

  it("un jugador no puede bajarse el monto a cero", async () => {
    const { id, slug } = await crearPartido({ organizadorId: orgId, costo: 800 });
    const j = await anotarse(slug, "Rata");
    const partido = await leerPartido(id);
    const { error: errorEquipo } = await orgCliente.rpc("guardar_equipos_partido", {
      p_partido_id: id,
      p_cambios: [{ jugador_id: j.fichaId, equipo: "team1" }],
      p_expected_version: Number(partido?.roster_version),
    });
    expect(errorEquipo).toBeNull();

    const { error } = await j.cliente
      .from("pagos")
      .update({ monto_esperado: 0 })
      .eq("jugador_id", j.fichaId);

    expect(error).toBeTruthy();
    expect(Number((await leerPago(j.fichaId))?.monto_esperado)).toBe(800);
  });

  it("un jugador no puede mudar su ficha a otro partido", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId });
    const otro = await crearPartido({ organizadorId: orgId });
    const j = await anotarse(slug, "Mudanza");

    const { error } = await j.cliente
      .from("jugadores")
      .update({ partido_id: otro.id })
      .eq("id", j.fichaId);

    expect(error).toBeTruthy();
  });

  it("sí puede cambiar su emoji (lo que la protección debe permitir)", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId });
    const j = await anotarse(slug, "Emojero");

    const { error } = await j.cliente
      .from("jugadores")
      .update({ emoji_o_color: "🔥" })
      .eq("id", j.fichaId);

    expect(error).toBeNull();
  });
});

describe("aislamiento entre jugadores y entre organizadores", () => {
  it("un jugador no ve el pago de otro", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId, cupo: 4 });
    const a = await anotarse(slug, "Ficha A");
    const b = await anotarse(slug, "Ficha B");

    const { data } = await b.cliente
      .from("pagos")
      .select("monto_esperado")
      .eq("jugador_id", a.fichaId);

    expect(data ?? []).toHaveLength(0);
  });

  it("un jugador no puede tocar la ficha de otro", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId, cupo: 4 });
    const a = await anotarse(slug, "Victima");
    const b = await anotarse(slug, "Atacante");

    await b.cliente.from("jugadores").update({ nombre: "Hackeado" }).eq("id", a.fichaId);

    expect((await leerFicha(a.fichaId))?.nombre).toBe("Victima");
  });

  it("un jugador no puede borrar la ficha de otro", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId, cupo: 4 });
    const a = await anotarse(slug, "No Me Borres");
    const b = await anotarse(slug, "Malicioso");

    await b.cliente.from("jugadores").delete().eq("id", a.fichaId);

    expect(await leerFicha(a.fichaId)).not.toBeNull();
  });

  it("un organizador no ve los partidos de otro organizador", async () => {
    const otroOrg = await organizador();
    await crearPartido({ organizadorId: orgId });

    const { data } = await otroOrg.cliente.from("partidos").select("id");

    expect(data ?? []).toHaveLength(0);
  });

  it("un organizador no puede confirmar pagos de un partido ajeno", async () => {
    const intruso = await organizador();
    const { slug } = await crearPartido({ organizadorId: orgId, costo: 700 });
    const j = await anotarse(slug, "Ajeno");

    await admin()
      .from("pagos")
      .update({ estado: "pendiente_confirmacion" })
      .eq("jugador_id", j.fichaId);

    const { data } = await intruso.cliente
      .from("pagos")
      .update({ estado: "confirmado", confirmado_por: intruso.id })
      .eq("jugador_id", j.fichaId)
      .select("id");

    expect(data ?? []).toHaveLength(0);
    expect((await leerPago(j.fichaId))?.estado).toBe("pendiente_confirmacion");
  });

  it("un jugador anónimo no puede crear partidos", async () => {
    const colado = await jugador();
    const { data: { user } } = await colado.auth.getUser();

    const { error } = await colado.from("partidos").insert({
      organizador_id: user!.id,
      fecha_hora: new Date().toISOString(),
      cantidad_jugadores: 10,
      costo_total: 100,
      link_slug: "colado12345",
      estado: "abierto",
    });

    expect(error).toBeTruthy();
  });
});

describe("el organizador sí puede hacer lo suyo", () => {
  it("confirma un pago de su propio partido", async () => {
    const org = await organizador();
    const { id, slug } = await crearPartido({ organizadorId: org.id, costo: 600 });
    const j = await anotarse(slug, "Pagador Legit");
    const partido = await leerPartido(id);
    const { error: errorEquipo } = await org.cliente.rpc("guardar_equipos_partido", {
      p_partido_id: id,
      p_cambios: [{ jugador_id: j.fichaId, equipo: "team1" }],
      p_expected_version: Number(partido?.roster_version),
    });
    expect(errorEquipo).toBeNull();

    await j.cliente
      .from("pagos")
      .update({ estado: "pendiente_confirmacion" })
      .eq("jugador_id", j.fichaId);

    const { error } = await org.cliente
      .from("pagos")
      .update({ estado: "confirmado", confirmado_por: org.id })
      .eq("jugador_id", j.fichaId);

    expect(error).toBeNull();

    const pago = await leerPago(j.fichaId);
    expect(pago?.estado).toBe("confirmado");
    expect(Number(pago?.monto_pagado)).toBe(600);
  });

  it("ve los jugadores y pagos de su partido", async () => {
    const org = await organizador();
    const { slug } = await crearPartido({ organizadorId: org.id, cupo: 4 });
    await anotarse(slug, "Visible A");
    await anotarse(slug, "Visible B");

    const { data } = await org.cliente.from("jugadores").select("nombre");
    expect((data ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
