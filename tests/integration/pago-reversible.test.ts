import { describe, it, expect, beforeAll } from "vitest";

import { organizador, crearPartido, anotarse, leerPago, admin } from "./_entorno";

let org: Awaited<ReturnType<typeof organizador>>;

beforeAll(async () => {
  org = await organizador();
});

/** Mismo patrón que confirmarPago(): sin filtro de estado (00026). */
function confirmar(fichaId: string) {
  return org.cliente
    .from("pagos")
    .update({ estado: "confirmado", confirmado_por: org.id })
    .eq("jugador_id", fichaId)
    .select("id");
}

/** Igual, pero explota si falla: para armar el escenario de otro test. */
async function confirmarComoOrganizador(fichaId: string) {
  await admin().from("pagos").update({ estado: "pendiente_confirmacion" }).eq("jugador_id", fichaId);
  const { error } = await confirmar(fichaId);
  if (error) throw new Error(`no se pudo confirmar para el test: ${error.message}`);
}

/** Mismo patrón que revertirPago(): confirmado -> sin_declarar. */
function revertirComoOrganizador(fichaId: string) {
  return org.cliente
    .from("pagos")
    .update({
      estado: "sin_declarar",
      monto_pagado: null,
      confirmado_por: null,
      confirmado_at: null,
    })
    .eq("jugador_id", fichaId)
    .eq("estado", "confirmado")
    .select("id");
}

describe("pago reversible: confirmado -> sin_declarar", () => {
  it("el organizador puede revertir un pago confirmado por error", async () => {
    const { slug } = await crearPartido({ organizadorId: org.id });
    const { fichaId } = await anotarse(slug, "Revertible");
    await confirmarComoOrganizador(fichaId);

    const { data, error } = await revertirComoOrganizador(fichaId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const pago = await leerPago(fichaId);
    expect(pago?.estado).toBe("sin_declarar");
    expect(pago?.monto_pagado).toBeNull();
  });

  it("no toca comprobante_url: sigue disponible para revisar de nuevo", async () => {
    const { slug } = await crearPartido({ organizadorId: org.id });
    const { fichaId } = await anotarse(slug, "ConComprobante");
    await admin()
      .from("pagos")
      .update({ comprobante_url: `${fichaId}/comprobante.jpg` })
      .eq("jugador_id", fichaId);
    await confirmarComoOrganizador(fichaId);

    await revertirComoOrganizador(fichaId);

    const pago = await leerPago(fichaId);
    expect(pago?.comprobante_url).toBe(`${fichaId}/comprobante.jpg`);
  });

  it("no hace nada si el pago no está confirmado (evita reversiones dobles)", async () => {
    const { slug } = await crearPartido({ organizadorId: org.id });
    const { fichaId } = await anotarse(slug, "SinConfirmar");

    const { data, error } = await revertirComoOrganizador(fichaId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("un jugador no puede revertir su propio pago confirmado", async () => {
    const { slug } = await crearPartido({ organizadorId: org.id });
    const { fichaId, cliente } = await anotarse(slug, "Propio");
    await confirmarComoOrganizador(fichaId);

    const { error } = await cliente
      .from("pagos")
      .update({
        estado: "sin_declarar",
        monto_pagado: null,
        confirmado_por: null,
        confirmado_at: null,
      })
      .eq("jugador_id", fichaId)
      .eq("estado", "confirmado");

    expect(error).toBeTruthy();

    const pago = await leerPago(fichaId);
    expect(pago?.estado).toBe("confirmado");
  });
});

/**
 * 00025 trajo esta feature SIN tests, y 00020 la borraba en silencio al
 * redefinir la misma función. 00026 unificó las dos; esto lo fija.
 */
describe("confirmar sin declaración previa", () => {
  it("el organizador confirma un pago que el jugador nunca declaró (efectivo)", async () => {
    const { slug } = await crearPartido({ organizadorId: org.id });
    const { fichaId } = await anotarse(slug, "PagoEnMano");

    const antes = await leerPago(fichaId);
    expect(antes?.estado).toBe("sin_declarar");

    const { data, error } = await confirmar(fichaId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const pago = await leerPago(fichaId);
    expect(pago?.estado).toBe("confirmado");
    expect(pago?.monto_pagado).toBe(antes?.monto_esperado);
  });

  it("también confirma un pago que había sido rechazado", async () => {
    const { slug } = await crearPartido({ organizadorId: org.id });
    const { fichaId } = await anotarse(slug, "Rechazado");
    await admin()
      .from("pagos")
      .update({ estado: "rechazado" })
      .eq("jugador_id", fichaId);

    const { error } = await confirmar(fichaId);
    expect(error).toBeNull();

    const pago = await leerPago(fichaId);
    expect(pago?.estado).toBe("confirmado");
  });

  it("no deja confirmar dos veces: pisaría el monto congelado", async () => {
    const { slug } = await crearPartido({ organizadorId: org.id });
    const { fichaId } = await anotarse(slug, "DobleConfirma");
    await confirmar(fichaId);

    const { error } = await confirmar(fichaId);
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/ya está confirmado/i);
  });

  it("SEGURIDAD: aflojar CUÁNDO no aflojó QUIÉN — el jugador no se autoconfirma", async () => {
    const { slug } = await crearPartido({ organizadorId: org.id });
    const { fichaId, cliente } = await anotarse(slug, "Vivo");

    const { error } = await cliente
      .from("pagos")
      .update({ estado: "confirmado", confirmado_por: org.id })
      .eq("jugador_id", fichaId);

    expect(error).toBeTruthy();

    const pago = await leerPago(fichaId);
    expect(pago?.estado).toBe("sin_declarar");
  });

  it("las DOS features conviven: confirmar sin declarar, revertir, confirmar de nuevo", async () => {
    // El test que prueba que 00026 hizo su trabajo. Si alguien vuelve a
    // redefinir verificar_confirmacion_pago con una sola de las dos ramas,
    // este se pone rojo.
    const { slug } = await crearPartido({ organizadorId: org.id });
    const { fichaId } = await anotarse(slug, "IdaYVuelta");

    expect((await confirmar(fichaId)).error).toBeNull();
    expect((await leerPago(fichaId))?.estado).toBe("confirmado");

    expect((await revertirComoOrganizador(fichaId)).error).toBeNull();
    expect((await leerPago(fichaId))?.estado).toBe("sin_declarar");

    expect((await confirmar(fichaId)).error).toBeNull();
    expect((await leerPago(fichaId))?.estado).toBe("confirmado");
  });
});
