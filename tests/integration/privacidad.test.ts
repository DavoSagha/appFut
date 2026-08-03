import { describe, it, expect, beforeAll } from "vitest";

import { organizador, crearPartido, anotarse, jugador } from "./_entorno";

let org: Awaited<ReturnType<typeof organizador>>;

beforeAll(async () => {
  org = await organizador();
});

async function resumenPublico(cliente: Awaited<ReturnType<typeof jugador>>, slug: string) {
  const { data, error } = await cliente.rpc("resumen_publico_por_slug", {
    p_slug: slug,
  });
  if (error) throw new Error(`resumen_publico_por_slug falló: ${error.message}`);
  return (data as { anotados: number; ya_estoy: boolean }[])[0];
}

describe("resumen público antes de unirse", () => {
  it("cuenta a los anotados pero nunca devuelve nombres", async () => {
    const { slug } = await crearPartido({ organizadorId: org.id, cupo: 4 });
    await anotarse(slug, "Uno");
    await anotarse(slug, "Dos");

    const visitante = await jugador();
    const resumen = await resumenPublico(visitante, slug);

    expect(resumen.anotados).toBe(2);
    expect(resumen.ya_estoy).toBe(false);
    expect(Object.keys(resumen).sort()).toEqual(["anotados", "ya_estoy"]);
  });

  it("ya_estoy es true sólo para quien ya tiene ficha en ese partido", async () => {
    const { slug } = await crearPartido({ organizadorId: org.id, cupo: 4 });
    const { cliente } = await anotarse(slug, "Adentro");

    expect((await resumenPublico(cliente, slug)).ya_estoy).toBe(true);

    const otro = await jugador();
    expect((await resumenPublico(otro, slug)).ya_estoy).toBe(false);
  });

  it("un código que no existe no distingue de un partido vacío", async () => {
    const visitante = await jugador();
    const resumen = await resumenPublico(visitante, "codigoinventado");

    expect(resumen).toEqual({ anotados: 0, ya_estoy: false });
  });
});
