import { describe, it, expect } from "vitest";

import { eliminarPartidoConResiduos, BUCKET_COMPROBANTES } from "@/lib/borrado";

import {
  organizador,
  crearPartido,
  marcarComoJugado,
  anotarse,
  leerFicha,
  leerPago,
  leerPartido,
  admin,
} from "./_entorno";

/**
 * Borrado de un partido ya jugado, sin residuos.
 *
 * Ejerce `eliminarPartidoConResiduos` — la MISMA función que llama la Server
 * Action — con el cliente del organizador, así que las policies de RLS y de
 * Storage se evalúan de verdad.
 */

// Cada test crea su propio organizador: el aislamiento importa más acá,
// donde se borran cosas, que en el resto de la suite.

/** Sube un comprobante como lo haría el jugador desde su teléfono. */
async function subirComprobante(
  cliente: Awaited<ReturnType<typeof anotarse>>["cliente"],
  partidoId: string,
  fichaId: string
): Promise<string> {
  const ruta = `${partidoId}/${fichaId}/comprobante.jpg`;
  const { error } = await cliente.storage
    .from(BUCKET_COMPROBANTES)
    .upload(ruta, new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]), {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (error) throw new Error(`No se pudo subir el comprobante: ${error.message}`);

  await cliente
    .from("pagos")
    .update({ comprobante_url: ruta, estado: "pendiente_confirmacion" })
    .eq("jugador_id", fichaId);

  return ruta;
}

async function archivosDe(partidoId: string, fichaId: string) {
  const { data } = await admin()
    .storage.from(BUCKET_COMPROBANTES)
    .list(`${partidoId}/${fichaId}`);
  return data ?? [];
}

describe("restricción temporal", () => {
  it("NO se puede borrar un partido que todavía no se jugó", async () => {
    const org = await organizador();
    const { id } = await crearPartido({ organizadorId: org.id });

    const res = await eliminarPartidoConResiduos(org.cliente, id);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.motivo).toBe("todavia_no_jugado");
    expect(await leerPartido(id)).not.toBeNull();
  });

  it("la policy de la base también lo frena, no solo la app", async () => {
    // Defensa en profundidad: aunque alguien saltee la función y mande el
    // DELETE crudo, RLS no lo deja.
    const org = await organizador();
    const { id } = await crearPartido({ organizadorId: org.id });

    const { data } = await org.cliente
      .from("partidos")
      .delete()
      .eq("id", id)
      .select("id");

    expect(data ?? []).toHaveLength(0);
    expect(await leerPartido(id)).not.toBeNull();
  });

  it("SÍ se puede borrar uno ya jugado", async () => {
    const org = await organizador();
    const { id } = await crearPartido({ organizadorId: org.id, jugado: true });

    const res = await eliminarPartidoConResiduos(org.cliente, id);

    expect(res.ok).toBe(true);
    expect(await leerPartido(id)).toBeNull();
  });
});

describe("no quedan residuos", () => {
  it("se van los jugadores y los pagos por cascade", async () => {
    const org = await organizador();
    const { id, slug } = await crearPartido({ organizadorId: org.id, cupo: 4 });

    const a = await anotarse(slug, "Ana");
    const b = await anotarse(slug, "Beto");
    await marcarComoJugado(id);

    expect(await leerFicha(a.fichaId)).not.toBeNull();
    expect(await leerPago(a.fichaId)).not.toBeNull();

    const res = await eliminarPartidoConResiduos(org.cliente, id);
    expect(res.ok).toBe(true);

    expect(await leerFicha(a.fichaId)).toBeNull();
    expect(await leerFicha(b.fichaId)).toBeNull();
    expect(await leerPago(a.fichaId)).toBeNull();
    expect(await leerPago(b.fichaId)).toBeNull();

    const { count } = await admin()
      .from("jugadores")
      .select("id", { count: "exact", head: true })
      .eq("partido_id", id);
    expect(count).toBe(0);
  });

  it("se van los comprobantes de Storage", async () => {
    // Este es el residuo de verdad: Storage no tiene FK, no cascadea nada.
    // Sin esta limpieza quedan capturas de transferencias bancarias
    // huérfanas en el bucket, para siempre.
    const org = await organizador();
    const { id, slug } = await crearPartido({ organizadorId: org.id, cupo: 2 });

    const jug = await anotarse(slug, "Con Comprobante");
    await subirComprobante(jug.cliente, id, jug.fichaId);
    await marcarComoJugado(id);

    expect(await archivosDe(id, jug.fichaId)).toHaveLength(1);

    const res = await eliminarPartidoConResiduos(org.cliente, id);
    expect(res.ok).toBe(true);

    expect(await archivosDe(id, jug.fichaId)).toHaveLength(0);
  });

  it("barre también un archivo huérfano que no figura en ningún pago", async () => {
    // Si el upload salió bien pero el UPDATE de la fila falló, el archivo
    // no está referenciado por nadie. El barrido del bucket lo agarra igual.
    const org = await organizador();
    const { id, slug } = await crearPartido({ organizadorId: org.id, cupo: 2 });

    const jug = await anotarse(slug, "Huerfano");
    const ruta = `${id}/${jug.fichaId}/comprobante.jpg`;
    await jug.cliente.storage
      .from(BUCKET_COMPROBANTES)
      .upload(ruta, new Uint8Array([0xff, 0xd8, 0xff]), {
        contentType: "image/jpeg",
        upsert: true,
      });

    // A propósito: NO se actualiza pagos.comprobante_url.
    expect((await leerPago(jug.fichaId))?.comprobante_url).toBeNull();
    expect(await archivosDe(id, jug.fichaId)).toHaveLength(1);

    await marcarComoJugado(id);
    const res = await eliminarPartidoConResiduos(org.cliente, id);
    expect(res.ok).toBe(true);

    expect(await archivosDe(id, jug.fichaId)).toHaveLength(0);
  });
});

describe("quién puede borrar", () => {
  it("un organizador ajeno no puede borrar un partido que no es suyo", async () => {
    const dueño = await organizador();
    const intruso = await organizador();
    const { id } = await crearPartido({
      organizadorId: dueño.id,
      jugado: true,
    });

    const res = await eliminarPartidoConResiduos(intruso.cliente, id);

    expect(res.ok).toBe(false);
    expect(await leerPartido(id)).not.toBeNull();
  });

  it("un jugador no puede borrar el partido", async () => {
    const org = await organizador();
    const { id, slug } = await crearPartido({ organizadorId: org.id, cupo: 2 });
    const jug = await anotarse(slug, "Nadie");
    await marcarComoJugado(id);

    const res = await eliminarPartidoConResiduos(jug.cliente, id);

    expect(res.ok).toBe(false);
    expect(await leerPartido(id)).not.toBeNull();
  });

  it("un jugador tampoco puede borrar los comprobantes de un partido ajeno", async () => {
    const org = await organizador();
    const { id, slug } = await crearPartido({ organizadorId: org.id, cupo: 4 });

    const victima = await anotarse(slug, "Victima");
    const ruta = await subirComprobante(victima.cliente, id, victima.fichaId);

    const atacante = await anotarse(slug, "Atacante");
    await marcarComoJugado(id);
    await atacante.cliente.storage.from(BUCKET_COMPROBANTES).remove([ruta]);

    expect(await archivosDe(id, victima.fichaId)).toHaveLength(1);
  });
});
