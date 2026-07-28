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

/**
 * Las reglas de negocio viven en triggers de Postgres. Son el corazón del
 * producto y donde estuvieron TODOS los bugs. Esto las ejerce de verdad.
 */

let orgId: string;

beforeAll(async () => {
  orgId = (await organizador()).id;
});

describe("asignación de roles", () => {
  it("el primero que llega es titular", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId, cupo: 2 });
    const { fichaId, accion } = await anotarse(slug, "Primero");

    expect(accion).toBe("creada");
    expect((await leerFicha(fichaId))?.rol).toBe("titular");
  });

  it("una vez lleno el cupo, los que siguen entran de suplentes", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId, cupo: 2 });

    const a = await anotarse(slug, "Titular A");
    const b = await anotarse(slug, "Titular B");
    const c = await anotarse(slug, "Suplente C");

    expect((await leerFicha(a.fichaId))?.rol).toBe("titular");
    expect((await leerFicha(b.fichaId))?.rol).toBe("titular");
    expect((await leerFicha(c.fichaId))?.rol).toBe("suplente");
  });

  it("el partido pasa a 'completo' cuando se llena el cupo", async () => {
    const { id, slug } = await crearPartido({ organizadorId: orgId, cupo: 2 });

    expect((await leerPartido(id))?.estado).toBe("abierto");
    await anotarse(slug, "Uno");
    expect((await leerPartido(id))?.estado).toBe("abierto");
    await anotarse(slug, "Dos");
    expect((await leerPartido(id))?.estado).toBe("completo");
  });

  it("cada jugador entra con un orden_ingreso distinto", async () => {
    const { id, slug } = await crearPartido({ organizadorId: orgId, cupo: 4 });
    for (const n of ["Ana", "Beto", "Caro", "Dani"]) await anotarse(slug, n);

    const { data } = await admin()
      .from("jugadores")
      .select("orden_ingreso")
      .eq("partido_id", id);

    const ordenes = (data ?? []).map((j) => j.orden_ingreso);
    expect(new Set(ordenes).size).toBe(ordenes.length);
  });
});

describe("cálculo del monto esperado", () => {
  it("el PRIMER titular NO queda en cero", async () => {
    // Regresión: calcular_pago_esperado corría en un BEFORE INSERT, así que
    // contaba titulares sin la fila nueva. El primero quedaba en $0.
    const { slug } = await crearPartido({
      organizadorId: orgId,
      cupo: 2,
      costo: 1000,
    });
    const { fichaId } = await anotarse(slug, "Solo");

    expect(Number((await leerPago(fichaId))?.monto_esperado)).toBe(1000);
  });

  it("al entrar un titular nuevo, a TODOS les baja el monto", async () => {
    // Regresión: los montos de los ya anotados no se recalculaban nunca.
    // Cada uno quedaba con el divisor del momento en que entró.
    const { slug } = await crearPartido({
      organizadorId: orgId,
      cupo: 4,
      costo: 1200,
    });

    const a = await anotarse(slug, "Ana");
    expect(Number((await leerPago(a.fichaId))?.monto_esperado)).toBe(1200);

    const b = await anotarse(slug, "Beto");
    expect(Number((await leerPago(a.fichaId))?.monto_esperado)).toBe(600);
    expect(Number((await leerPago(b.fichaId))?.monto_esperado)).toBe(600);

    const c = await anotarse(slug, "Caro");
    expect(Number((await leerPago(a.fichaId))?.monto_esperado)).toBe(400);
    expect(Number((await leerPago(c.fichaId))?.monto_esperado)).toBe(400);
  });

  it("el suplente no paga", async () => {
    const { slug } = await crearPartido({
      organizadorId: orgId,
      cupo: 2,
      costo: 1000,
    });
    await anotarse(slug, "T1");
    await anotarse(slug, "T2");
    const sup = await anotarse(slug, "Sup");

    expect(Number((await leerPago(sup.fichaId))?.monto_esperado)).toBe(0);
  });

  it("un pago confirmado NO se recalcula cuando cambia el divisor", async () => {
    // Regresión: se pisaba monto_esperado de pagos ya confirmados, y el
    // dashboard mostraba plata que nunca entró.
    const { slug } = await crearPartido({
      organizadorId: orgId,
      cupo: 4,
      costo: 1200,
    });

    const a = await anotarse(slug, "Pagador");
    await anotarse(slug, "Otro"); // ahora son 600 c/u

    await admin()
      .from("pagos")
      .update({ estado: "pendiente_confirmacion" })
      .eq("jugador_id", a.fichaId);
    await admin()
      .from("pagos")
      .update({ estado: "confirmado", confirmado_por: orgId })
      .eq("jugador_id", a.fichaId);

    const antes = await leerPago(a.fichaId);
    expect(antes?.estado).toBe("confirmado");
    expect(Number(antes?.monto_pagado)).toBe(600);

    await anotarse(slug, "Tercero"); // el divisor cambia a 400

    const despues = await leerPago(a.fichaId);
    expect(Number(despues?.monto_esperado)).toBe(600);
    expect(Number(despues?.monto_pagado)).toBe(600);
  });
});

describe("baja de un titular", () => {
  it("promueve al primer suplente", async () => {
    // Regresión: sin policy de DELETE esto NUNCA funcionó, y el trigger
    // AFTER DELETE era código muerto en producción.
    const { slug } = await crearPartido({ organizadorId: orgId, cupo: 2 });

    const t1 = await anotarse(slug, "Titular 1");
    await anotarse(slug, "Titular 2");
    const sup = await anotarse(slug, "Suplente");

    expect((await leerFicha(sup.fichaId))?.rol).toBe("suplente");

    const { error } = await t1.cliente
      .from("jugadores")
      .delete()
      .eq("id", t1.fichaId);
    expect(error).toBeNull();

    expect(await leerFicha(t1.fichaId)).toBeNull();
    expect((await leerFicha(sup.fichaId))?.rol).toBe("titular");
  });

  it("si no hay suplentes, el partido vuelve a 'abierto'", async () => {
    const { id, slug } = await crearPartido({ organizadorId: orgId, cupo: 2 });

    const t1 = await anotarse(slug, "Uno");
    await anotarse(slug, "Dos");
    expect((await leerPartido(id))?.estado).toBe("completo");

    await t1.cliente.from("jugadores").delete().eq("id", t1.fichaId);

    expect((await leerPartido(id))?.estado).toBe("abierto");
  });

  it("el organizador puede eliminar a cualquier jugador de SU partido", async () => {
    const org = await organizador();
    const { slug } = await crearPartido({ organizadorId: org.id, cupo: 2 });
    const j = await anotarse(slug, "Sacame");

    const { error } = await org.cliente
      .from("jugadores")
      .delete()
      .eq("id", j.fichaId);

    expect(error).toBeNull();
    expect(await leerFicha(j.fichaId)).toBeNull();
  });
});

describe("partido cerrado", () => {
  it("no se puede entrar", async () => {
    const { id, slug } = await crearPartido({ organizadorId: orgId, cupo: 4 });
    await admin().from("partidos").update({ estado: "cerrado" }).eq("id", id);

    await expect(anotarse(slug, "Tarde")).rejects.toThrow(/cerrado/i);
  });
});
