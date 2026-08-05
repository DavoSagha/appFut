import { describe, it, expect } from "vitest";

import { partidoVencido, estadoEfectivo } from "@/lib/estado-partido";

const AHORA = new Date("2026-08-04T21:00:00.000Z");

describe("partidoVencido", () => {
  it("es false mientras la fecha_hora todavía no llegó", () => {
    expect(partidoVencido("2026-08-04T21:00:01.000Z", AHORA)).toBe(false);
    expect(partidoVencido("2026-08-05T20:00:00.000Z", AHORA)).toBe(false);
  });

  it("es true apenas se cumple la fecha_hora exacta", () => {
    expect(partidoVencido("2026-08-04T21:00:00.000Z", AHORA)).toBe(true);
  });

  it("es true una vez pasada la fecha_hora", () => {
    expect(partidoVencido("2026-08-04T20:59:59.000Z", AHORA)).toBe(true);
    expect(partidoVencido("2026-08-03T21:00:00.000Z", AHORA)).toBe(true);
  });

  it("distingue por hora dentro del mismo día, no sólo por fecha", () => {
    // El mismo día del partido: a las 23hs todavía no venció; a las 20hs sí.
    expect(partidoVencido("2026-08-04T23:00:00.000Z", AHORA)).toBe(false);
    expect(partidoVencido("2026-08-04T20:00:00.000Z", AHORA)).toBe(true);
  });

  it("acepta Date además de string ISO", () => {
    expect(partidoVencido(new Date("2026-08-04T20:00:00.000Z"), AHORA)).toBe(true);
    expect(partidoVencido(new Date("2026-08-05T20:00:00.000Z"), AHORA)).toBe(false);
  });

  it("ante una fecha ilegible NO vence: un bug de parseo no puede trabar un partido vigente", () => {
    expect(partidoVencido("no-es-una-fecha", AHORA)).toBe(false);
  });
});

describe("estadoEfectivo", () => {
  it("respeta el estado guardado mientras el partido no venció", () => {
    const futuro = "2026-08-05T20:00:00.000Z";
    expect(estadoEfectivo({ estado: "abierto", fecha_hora: futuro }, AHORA)).toBe("abierto");
    expect(estadoEfectivo({ estado: "completo", fecha_hora: futuro }, AHORA)).toBe("completo");
    expect(estadoEfectivo({ estado: "cerrado", fecha_hora: futuro }, AHORA)).toBe("cerrado");
  });

  it("devuelve cerrado en cuanto pasó la fecha_hora, sin importar el estado guardado", () => {
    const pasado = "2026-08-03T20:00:00.000Z";
    expect(estadoEfectivo({ estado: "abierto", fecha_hora: pasado }, AHORA)).toBe("cerrado");
    expect(estadoEfectivo({ estado: "completo", fecha_hora: pasado }, AHORA)).toBe("cerrado");
    expect(estadoEfectivo({ estado: "cerrado", fecha_hora: pasado }, AHORA)).toBe("cerrado");
  });

  it("no muta el partido que recibe", () => {
    const partido = { estado: "abierto" as const, fecha_hora: "2026-08-03T20:00:00.000Z" };
    estadoEfectivo(partido, AHORA);
    expect(partido.estado).toBe("abierto");
  });
});
