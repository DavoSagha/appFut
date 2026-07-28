import { describe, it, expect, beforeAll } from "vitest";

import {
  organizador,
  crearPartido,
  anotarse,
  jugador,
  leerFicha,
  admin,
} from "./_entorno";

/**
 * El requisito: si el jugador pierde la sesión anónima (limpió el navegador,
 * cambió de teléfono), tiene que poder volver escribiendo el mismo nombre y
 * seguir con lo suyo.
 */

let orgId: string;

beforeAll(async () => {
  orgId = (await organizador()).id;
});

describe("unirse_o_reclamar", () => {
  it("un nombre nuevo crea la ficha", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId });
    const { accion } = await anotarse(slug, "Nuevo");
    expect(accion).toBe("creada");
  });

  it("el mismo usuario repitiendo el nombre no duplica nada", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId });
    const primero = await anotarse(slug, "Repetido");

    const { data } = await primero.cliente.rpc("unirse_o_reclamar", {
      p_slug: slug,
      p_nombre: "Repetido",
    });
    const fila = (data as { jugador_id: string; accion: string }[])[0];

    expect(fila.accion).toBe("ya_estabas");
    expect(fila.jugador_id).toBe(primero.fichaId);
  });

  it("PERDÍ LA SESIÓN: vuelvo con el mismo nombre y recupero mi ficha", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId });
    const original = await anotarse(slug, "Martín");
    const dueñoOriginal = (await leerFicha(original.fichaId))?.user_id;

    // Navegador nuevo = usuario anónimo nuevo.
    const reencarnado = await anotarse(slug, "Martín");

    expect(reencarnado.accion).toBe("reclamada");
    expect(reencarnado.fichaId).toBe(original.fichaId);

    const ficha = await leerFicha(original.fichaId);
    expect(ficha?.user_id).not.toBe(dueñoOriginal);
    expect(ficha?.user_id).toBeTruthy();
  });

  it("el reclamo no distingue mayúsculas", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId });
    const original = await anotarse(slug, "aa");
    const vuelta = await anotarse(slug, "AA");

    expect(vuelta.accion).toBe("reclamada");
    expect(vuelta.fichaId).toBe(original.fichaId);
  });

  it("el reclamo ignora espacios de más", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId });
    const original = await anotarse(slug, "Juan Carlos");
    const vuelta = await anotarse(slug, "  Juan   Carlos  ");

    expect(vuelta.accion).toBe("reclamada");
    expect(vuelta.fichaId).toBe(original.fichaId);
  });

  it("no crea una ficha duplicada al reclamar", async () => {
    const { id, slug } = await crearPartido({ organizadorId: orgId, cupo: 4 });
    await anotarse(slug, "Único");
    await anotarse(slug, "Único");
    await anotarse(slug, "Único");

    const { count } = await admin()
      .from("jugadores")
      .select("id", { count: "exact", head: true })
      .eq("partido_id", id);

    expect(count).toBe(1);
  });

  it("una ficha SIN dueño (cargada por el organizador) se reclama libre", async () => {
    const { id, slug } = await crearPartido({ organizadorId: orgId });
    await admin()
      .from("jugadores")
      .insert({ partido_id: id, nombre: "Cargado", user_id: null });

    const { accion } = await anotarse(slug, "Cargado");
    expect(accion).toBe("reclamada_libre");
  });

  it("el que ya tiene ficha y escribe OTRO nombre se queda con la suya", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId, cupo: 4 });
    const mio = await anotarse(slug, "Mi Nombre");

    const { data } = await mio.cliente.rpc("unirse_o_reclamar", {
      p_slug: slug,
      p_nombre: "Otro Nombre Cualquiera",
    });
    const fila = (data as { jugador_id: string; accion: string }[])[0];

    expect(fila.accion).toBe("ya_estabas");
    expect(fila.jugador_id).toBe(mio.fichaId);
  });

  it("deja rastro de auditoría de quién tenía la ficha antes", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId });
    const original = await anotarse(slug, "Rastreado");
    const dueñoViejo = (await leerFicha(original.fichaId))?.user_id;

    await anotarse(slug, "Rastreado");

    const { data } = await admin()
      .from("jugadores")
      .select("user_id_anterior, reclamado_at")
      .eq("id", original.fichaId)
      .single();

    expect(data?.user_id_anterior).toBe(dueñoViejo);
    expect(data?.reclamado_at).toBeTruthy();
  });
});

describe("validaciones de entrada", () => {
  it("rechaza un nombre demasiado corto", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId });
    await expect(anotarse(slug, "a")).rejects.toThrow(/nombre/i);
  });

  it("rechaza un nombre demasiado largo", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId });
    await expect(anotarse(slug, "x".repeat(51))).rejects.toThrow(/largo/i);
  });

  it("rechaza un slug que no existe", async () => {
    await expect(anotarse("noexistenada", "Alguien")).rejects.toThrow(
      /no encontrado/i
    );
  });

  it("un visitante sin sesión no puede ni llamar a la función", async () => {
    const { slug } = await crearPartido({ organizadorId: orgId });
    const { anonimoSinSesion } = await import("./_entorno");

    const { error } = await anonimoSinSesion().rpc("unirse_o_reclamar", {
      p_slug: slug,
      p_nombre: "Colado",
    });

    expect(error).toBeTruthy();
  });
});

describe("comportamiento actual con pago confirmado", () => {
  it("BLOQUEA el reclamo si el pago ya está confirmado", async () => {
    // Este test documenta lo que hace HOY 00014_fix_ambiguo.sql.
    // Ojo: contradice el pedido de "poner el nombre y entrar, siempre".
    // Si se decide que el reclamo sea incondicional, este test tiene que
    // cambiar junto con la migración — no borrarse en silencio.
    const { slug } = await crearPartido({ organizadorId: orgId, costo: 500 });
    const j = await anotarse(slug, "Pagó");

    await admin()
      .from("pagos")
      .update({ estado: "pendiente_confirmacion" })
      .eq("jugador_id", j.fichaId);
    await admin()
      .from("pagos")
      .update({ estado: "confirmado", confirmado_por: orgId })
      .eq("jugador_id", j.fichaId);

    const otro = await jugador();
    const { error } = await otro.rpc("unirse_o_reclamar", {
      p_slug: slug,
      p_nombre: "Pagó",
    });

    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/confirmado/i);
  });
});
