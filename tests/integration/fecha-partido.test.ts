import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";

import { organizador, admin } from "./_entorno";

let org: Awaited<ReturnType<typeof organizador>>;

beforeAll(async () => {
  org = await organizador();
});

function slug() {
  return randomUUID().replace(/[^a-z0-9]/g, "").slice(0, 12);
}

function partidoBase(fechaHora: string) {
  return {
    organizador_id: org.id,
    fecha_hora: fechaHora,
    cantidad_jugadores: 10,
    costo_total: 1000,
    link_slug: slug(),
    estado: "abierto" as const,
  };
}

describe("validación de fecha al crear un partido", () => {
  it("el organizador no puede crear un partido en el pasado", async () => {
    const { error } = await org.cliente
      .from("partidos")
      .insert(partidoBase(new Date(Date.now() - 60_000).toISOString()));

    expect(error?.message).toMatch(/al menos 2 horas/);
  });

  it("el organizador no puede crear un partido con menos de 2 horas de aviso", async () => {
    const { error } = await org.cliente
      .from("partidos")
      .insert(partidoBase(new Date(Date.now() + 60 * 60 * 1000).toISOString()));

    expect(error?.message).toMatch(/al menos 2 horas/);
  });

  it("sí puede crear un partido con más de 2 horas de aviso", async () => {
    const { error } = await org.cliente
      .from("partidos")
      .insert(partidoBase(new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()));

    expect(error).toBeNull();
  });

  it("service_role sigue pudiendo armar fixtures con fecha pasada (mantenimiento/tests)", async () => {
    const { error } = await admin()
      .from("partidos")
      .insert(partidoBase(new Date(Date.now() - 86_400_000).toISOString()));

    expect(error).toBeNull();
  });
});
