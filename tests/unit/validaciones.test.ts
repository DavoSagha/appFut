import { describe, it, expect } from "vitest";

import {
  esUuid,
  esSlug,
  normalizarNombre,
  generarSlug,
  validarFechaPartido,
  validarResultado,
  ANTICIPACION_MINIMA_HORAS,
  ALFABETO_SLUG,
  LARGO_SLUG,
} from "@/lib/validaciones";

describe("esUuid", () => {
  it("acepta un uuid válido en cualquier caja", () => {
    expect(esUuid("367b8a55-3d88-4688-afc2-66336d3c6777")).toBe(true);
    expect(esUuid("367B8A55-3D88-4688-AFC2-66336D3C6777")).toBe(true);
  });

  it("rechaza basura", () => {
    expect(esUuid("")).toBe(false);
    expect(esUuid("no-soy-un-uuid")).toBe(false);
    expect(esUuid(null)).toBe(false);
    expect(esUuid(123)).toBe(false);
    // Un guion de menos.
    expect(esUuid("367b8a553d88-4688-afc2-66336d3c6777")).toBe(false);
  });

  it("rechaza intentos de inyección", () => {
    expect(esUuid("367b8a55-3d88-4688-afc2-66336d3c6777' OR '1'='1")).toBe(false);
  });
});

describe("esSlug", () => {
  it("acepta los slugs viejos de 8 y los nuevos de 10", () => {
    expect(esSlug("abc12345")).toBe(true);
    expect(esSlug("abcdefgh23")).toBe(true);
  });

  it("rechaza mayúsculas, símbolos y largos fuera de rango", () => {
    expect(esSlug("ABC12345")).toBe(false);
    expect(esSlug("abc-1234")).toBe(false);
    expect(esSlug("abc")).toBe(false);
    expect(esSlug("a".repeat(17))).toBe(false);
    expect(esSlug(undefined)).toBe(false);
  });

  it("rechaza path traversal", () => {
    expect(esSlug("../../etc")).toBe(false);
    expect(esSlug("abc/12345")).toBe(false);
  });
});

describe("normalizarNombre", () => {
  it("recorta y colapsa espacios", () => {
    expect(normalizarNombre("  Martín  ")).toBe("Martín");
    expect(normalizarNombre("Juan    Carlos")).toBe("Juan Carlos");
    expect(normalizarNombre("\tPedro\n")).toBe("Pedro");
  });

  it("es idempotente: normalizar dos veces da lo mismo", () => {
    const sucio = "  Juan   Carlos  ";
    expect(normalizarNombre(normalizarNombre(sucio))).toBe(normalizarNombre(sucio));
  });

  it("no explota con null ni undefined", () => {
    expect(normalizarNombre(null)).toBe("");
    expect(normalizarNombre(undefined)).toBe("");
  });
});

describe("validarFechaPartido", () => {
  const ahora = new Date("2026-08-03T18:00:00.000Z");

  it("rechaza una fecha que ya pasó", () => {
    expect(validarFechaPartido("2026-08-03T10:00:00.000Z", ahora)).toEqual({
      ok: false,
      error: `El partido debe crearse con al menos ${ANTICIPACION_MINIMA_HORAS} horas de anticipación`,
    });
  });

  it("rechaza un horario a menos de 2 horas, aunque sea hoy más tarde", () => {
    expect(validarFechaPartido("2026-08-03T19:00:00.000Z", ahora)).toEqual({
      ok: false,
      error: `El partido debe crearse con al menos ${ANTICIPACION_MINIMA_HORAS} horas de anticipación`,
    });
  });

  it("acepta justo el límite de 2 horas", () => {
    expect(validarFechaPartido("2026-08-03T20:00:00.000Z", ahora)).toEqual({ ok: true });
  });

  it("acepta una fecha bien futura", () => {
    expect(validarFechaPartido("2026-08-10T20:00:00.000Z", ahora)).toEqual({ ok: true });
  });

  it("rechaza una fecha inválida", () => {
    expect(validarFechaPartido("no-es-una-fecha", ahora)).toEqual({
      ok: false,
      error: "Fecha u hora inválida",
    });
  });
});

describe("validarResultado", () => {
  it("acepta dos enteros no negativos", () => {
    expect(validarResultado(6, 4)).toEqual({ ok: true, team1: 6, team2: 4 });
    expect(validarResultado(0, 0)).toEqual({ ok: true, team1: 0, team2: 0 });
  });

  it("rechaza negativos", () => {
    expect(validarResultado(-1, 2)).toEqual({ ok: false, error: "El resultado no puede ser negativo" });
    expect(validarResultado(2, -1)).toEqual({ ok: false, error: "El resultado no puede ser negativo" });
  });

  it("rechaza no enteros y valores no numéricos", () => {
    expect(validarResultado(1.5, 2)).toEqual({ ok: false, error: "El resultado debe ser un número entero" });
    expect(validarResultado("6", 4)).toEqual({ ok: false, error: "El resultado debe ser un número entero" });
    expect(validarResultado(NaN, 4)).toEqual({ ok: false, error: "El resultado debe ser un número entero" });
  });
});

describe("generarSlug", () => {
  it("respeta el largo y el alfabeto", () => {
    for (let i = 0; i < 200; i++) {
      const slug = generarSlug();
      expect(slug).toHaveLength(LARGO_SLUG);
      for (const c of slug) expect(ALFABETO_SLUG).toContain(c);
    }
  });

  it("no usa caracteres que se confunden al dictarlo por teléfono", () => {
    for (const prohibido of ["l", "o", "0", "1"]) {
      expect(ALFABETO_SLUG).not.toContain(prohibido);
    }
  });

  it("el alfabeto divide a 256, así que no hay sesgo de módulo", () => {
    expect(256 % ALFABETO_SLUG.length).toBe(0);
  });

  it("genera valores distintos (sin colisiones en 1000 tiradas)", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 1000; i++) vistos.add(generarSlug());
    expect(vistos.size).toBe(1000);
  });

  it("lo que genera pasa su propio validador", () => {
    for (let i = 0; i < 50; i++) {
      expect(esSlug(generarSlug())).toBe(true);
    }
  });
});
