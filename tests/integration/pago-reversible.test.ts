import { describe, it, expect, beforeAll } from "vitest";

import { organizador, crearPartido, anotarse, leerPago, admin } from "./_entorno";

let org: Awaited<ReturnType<typeof organizador>>;

beforeAll(async () => {
  org = await organizador();
});

/** Mismo patrón que confirmarPago(): pendiente -> confirmado. */
async function confirmarComoOrganizador(fichaId: string) {
  await admin().from("pagos").update({ estado: "pendiente_confirmacion" }).eq("jugador_id", fichaId);
  const { error } = await org.cliente
    .from("pagos")
    .update({ estado: "confirmado", confirmado_por: org.id })
    .eq("jugador_id", fichaId)
    .eq("estado", "pendiente_confirmacion");
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
