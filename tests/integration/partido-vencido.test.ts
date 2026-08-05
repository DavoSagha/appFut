import { describe, it, expect, beforeAll } from "vitest";

import {
  organizador,
  crearPartido,
  marcarComoJugado,
  anotarse,
  jugador,
  leerPago,
  admin,
} from "./_entorno";

let org: Awaited<ReturnType<typeof organizador>>;

beforeAll(async () => {
  org = await organizador();
});

/**
 * Un partido cuya fecha_hora ya pasó se comporta como cerrado (00022), sin
 * que nadie escriba `estado`. Estos tests ejercen el guard en la BASE, que es
 * el que no se puede saltar manipulando el fetch del cliente.
 */
describe("un partido vencido bloquea el ingreso de gente nueva", () => {
  it("no se puede unir por link una vez pasada la fecha y hora", async () => {
    const { id, slug } = await crearPartido({ organizadorId: org.id, cupo: 4 });
    await marcarComoJugado(id);

    const colado = await jugador();
    const { error } = await colado.rpc("unirse_o_reclamar", {
      p_slug: slug,
      p_nombre: "Tarde Piaste",
    });

    expect(error).toBeTruthy();
    expect(error?.message).toContain("cerrado");
  });

  it("el organizador tampoco puede dar de alta a mano en un partido vencido", async () => {
    const { id } = await crearPartido({ organizadorId: org.id, cupo: 4 });
    await marcarComoJugado(id);

    const { error } = await admin()
      .from("jugadores")
      .insert({ partido_id: id, nombre: "Alta Tardia", user_id: null });

    expect(error).toBeTruthy();
    expect(error?.message).toContain("cerrado");
  });

  it("mientras la fecha no llegó, unirse sigue funcionando normal", async () => {
    const { slug } = await crearPartido({ organizadorId: org.id, cupo: 4 });

    const { fichaId, accion } = await anotarse(slug, "A Tiempo");

    expect(accion).toBe("creada");
    expect(fichaId).toBeTruthy();
  });

  it("bloquea por HORA, no sólo por día: el mismo día pero ya pasada la hora está vencido", async () => {
    const { id, slug } = await crearPartido({ organizadorId: org.id, cupo: 4 });
    // Una hora atrás: mismo día calendario, hora ya cumplida.
    await admin()
      .from("partidos")
      .update({ fecha_hora: new Date(Date.now() - 3_600_000).toISOString() })
      .eq("id", id);

    const colado = await jugador();
    const { error } = await colado.rpc("unirse_o_reclamar", {
      p_slug: slug,
      p_nombre: "Una Hora Tarde",
    });

    expect(error).toBeTruthy();
    expect(error?.message).toContain("cerrado");
  });
});

/**
 * La contracara deliberada: en el fútbol amateur se paga DESPUÉS de jugar.
 * Si el vencimiento trabara la cobranza, el organizador no podría cerrar las
 * cuentas de su propio partido. Por eso los pagos se miden contra el estado
 * GUARDADO, nunca contra el vencimiento.
 */
describe("un partido vencido NO traba los pagos", () => {
  it("se puede declarar y confirmar el pago después de jugado", async () => {
    const { id, slug } = await crearPartido({ organizadorId: org.id, cupo: 2 });
    const { fichaId } = await anotarse(slug, "Paga Despues");
    await marcarComoJugado(id);

    const { error: errorDeclarar } = await admin()
      .from("pagos")
      .update({ estado: "pendiente_confirmacion" })
      .eq("jugador_id", fichaId);
    expect(errorDeclarar).toBeNull();

    const { error: errorConfirmar } = await org.cliente
      .from("pagos")
      .update({ estado: "confirmado", confirmado_por: org.id })
      .eq("jugador_id", fichaId)
      .eq("estado", "pendiente_confirmacion");

    expect(errorConfirmar).toBeNull();
    expect((await leerPago(fichaId))?.estado).toBe("confirmado");
  });
});
