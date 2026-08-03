import { describe, it, expect, beforeAll } from "vitest";

import { organizador, crearPartido, leerPartido } from "./_entorno";

let org: Awaited<ReturnType<typeof organizador>>;

beforeAll(async () => {
  org = await organizador();
});

/** Mismo patrón que guardarResultado(). */
function guardarComoOrganizador(cliente: typeof org.cliente, partidoId: string, team1: number, team2: number) {
  return cliente
    .from("partidos")
    .update({ resultado_team1: team1, resultado_team2: team2 })
    .eq("id", partidoId)
    .select("id");
}

describe("resultado final del partido", () => {
  it("el organizador puede cargarlo y después corregirlo", async () => {
    const { id } = await crearPartido({ organizadorId: org.id });

    const primero = await guardarComoOrganizador(org.cliente, id, 6, 4);
    expect(primero.error).toBeNull();
    expect((await leerPartido(id))).toMatchObject({ resultado_team1: 6, resultado_team2: 4 });

    const corregido = await guardarComoOrganizador(org.cliente, id, 3, 3);
    expect(corregido.error).toBeNull();
    expect((await leerPartido(id))).toMatchObject({ resultado_team1: 3, resultado_team2: 3 });
  });

  it("rechaza resultados negativos", async () => {
    const { id } = await crearPartido({ organizadorId: org.id });

    const { error } = await org.cliente
      .from("partidos")
      .update({ resultado_team1: -1, resultado_team2: 0 })
      .eq("id", id);

    expect(error).toBeTruthy();
  });

  it("no permite cargar un solo equipo: ambos o ninguno", async () => {
    const { id } = await crearPartido({ organizadorId: org.id });

    const { error } = await org.cliente
      .from("partidos")
      .update({ resultado_team1: 5, resultado_team2: null })
      .eq("id", id);

    expect(error).toBeTruthy();
  });

  it("un organizador ajeno no puede cargar el resultado de un partido que no es suyo", async () => {
    const { id } = await crearPartido({ organizadorId: org.id });
    const otro = await organizador();

    const { data } = await guardarComoOrganizador(otro.cliente, id, 1, 0);
    expect(data).toHaveLength(0);
    expect((await leerPartido(id))?.resultado_team1).toBeNull();
  });
});
