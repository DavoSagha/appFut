# Tests de appFut

## Correr

```bash
npm run test:unit    # No necesita nada. Corre siempre.
npm run test:int     # Necesita Docker Desktop + Supabase local.
npm test             # Todo.
```

### Para los de integración

1. Abrí **Docker Desktop** y esperá a que diga "Engine running"
2. `npm run db:start` — levanta Postgres + Auth + REST y aplica TODAS las
   migraciones en orden
3. `npm run test:int`

`db:start` excluye studio, realtime, edge-runtime y el stack de analytics
(`vector`/`logflare`). No hacen falta, tardan en levantar, y en Windows el
de analytics falla el health check y se lleva puesta toda la corrida.

**Storage sí queda levantado**: los tests de borrado suben y verifican
comprobantes de verdad.

## Node

Mínimo **20.9** (lo pide Next 16). **Recomendado: 22 LTS.**

Dos cosas dependen de esto:

- `tests/setup.ts` mete un polyfill de `WebSocket`, que llegó nativo recién
  en Node 22. Sin eso, `createClient()` de supabase-js explota antes de
  correr un solo test, aunque nunca se use Realtime.
- El config se llama `vitest.config.**mts**`, no `.ts`, a propósito. Con
  `.ts`, vitest lo carga por su puente CommonJS y termina haciendo
  `require()` de un módulo ESM de vite. Eso solo funciona desde Node 20.19,
  y en versiones anteriores revienta con:

  ```
  Error [ERR_REQUIRE_ESM]: require() of ES Module .../vite/dist/node/index.js
  ```

  La extensión `.mts` fuerza la carga como ESM y el problema desaparece en
  cualquier versión. **No lo renombres a `.ts`.**

Además, supabase-js ya avisa que va a dejar de soportar Node 20. Migrar a 22
saca ese warning y el polyfill queda al pedo (inofensivo, pero al pedo).

Si algo quedó sucio entre corridas: `npm run db:reset` reaplica todo desde cero.

Los tests leen la URL y las claves de `npx supabase status`. No tocan tu
proyecto remoto ni tu `.env.local`.

## Qué cubre cada archivo

| Archivo | Qué prueba |
|---|---|
| `unit/validaciones.test.ts` | Lógica pura: validadores, normalización de nombres, generación de slugs |
| `integration/dominio.test.ts` | Reglas de negocio: roles, montos, promoción de suplentes, estados del partido |
| `integration/reclamo.test.ts` | Recuperar la ficha escribiendo el mismo nombre |
| `integration/borrado.test.ts` | Eliminar un partido ya jugado sin dejar residuos (incluye Storage) |
| `integration/seguridad.test.ts` | **Regresiones de la auditoría.** Cada test es un agujero que ya existió |

## Sobre `seguridad.test.ts`

Cada test de ese archivo corresponde a una vulnerabilidad real que este
proyecto tuvo. No son hipótesis: pasaron.

Si uno de esos tests se pone rojo, alguien reabrió un agujero. **No se
relajan ni se borran para "que pase el build"** — se arregla el código.

Los más importantes:

- `un jugador no puede autoconfirmarse el pago` — el chain de dos UPDATEs
  que permitía marcar un pago como confirmado sin transferir un peso
- `anon no puede enumerar partidos` — cualquiera con la anon key (que es
  pública, va en el bundle) leía todas las tablas
- `un suplente no puede ascenderse a titular` — RLS filtra filas, no
  columnas; eso lo cubren los triggers

## Nota sobre el reclamo por nombre

`reclamo.test.ts` tiene un test llamado
`BLOQUEA el reclamo si el pago ya está confirmado`.

Documenta el comportamiento actual de `00014_fix_ambiguo.sql`. Si se decide
que el reclamo sea incondicional (escribir el nombre y entrar siempre), ese
test tiene que cambiar **junto con** la migración. No borrarlo en silencio:
el cambio implica que cualquiera con el link puede quedarse con la ficha de
otro, pago confirmado incluido.
