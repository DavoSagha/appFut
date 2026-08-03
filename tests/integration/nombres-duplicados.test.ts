import { describe, it, expect, beforeAll } from "vitest";

import { organizador, crearPartido } from "./_entorno";

let org: Awaited<ReturnType<typeof organizador>>;

beforeAll(async () => {
  org = await organizador();
});

/** Mismo patrón que agregarJugador(): ficha sin dueño, nombre ya normalizado. */
function altaManual(partidoId: string, nombre: string) {
  return org.cliente
    .from("jugadores")
    .insert({ partido_id: partidoId, nombre, user_id: null });
}

describe("altas manuales del organizador: nombres duplicados", () => {
  it("bloquea un nombre que ya existe, sin importar mayúsculas/espacios ya normalizados", async () => {
    const { id } = await crearPartido({ organizadorId: org.id, cupo: 10 });

    const primero = await altaManual(id, "Joa");
    expect(primero.error).toBeNull();

    const segundo = await altaManual(id, "joa");
    expect(segundo.error?.code).toBe("23505");
  });

  it("no permite que dos altas concurrentes con el mismo nombre normalizado pasen las dos", async () => {
    const { id } = await crearPartido({ organizadorId: org.id, cupo: 10 });

    const resultados = await Promise.all([
      altaManual(id, "Carla"),
      altaManual(id, "Carla"),
      altaManual(id, "Carla"),
    ]);

    const exitosos = resultados.filter((r) => r.error === null);
    const duplicados = resultados.filter((r) => r.error?.code === "23505");

    expect(exitosos.length).toBe(1);
    expect(duplicados.length).toBe(2);
  });
});
