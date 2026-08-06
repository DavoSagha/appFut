"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Partido } from "@/lib/db/types";
import { estadoEfectivo } from "@/lib/estado-partido";
import EstadoBadge from "@/components/EstadoBadge";

export default function OrganizadorDashboard() {
  const router = useRouter();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [partidos, setPartidos] = useState<Partido[]>([]);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);

  const cargarPartidos = useCallback(
    async (supabase: ReturnType<typeof createClient>, userId: string) => {
      const { data, error: err } = await supabase
        .from("partidos")
        .select("*")
        .eq("organizador_id", userId)
        .order("fecha_hora", { ascending: false });

      if (err) setError("No se pudieron cargar tus partidos");
      else setPartidos((data ?? []) as Partido[]);

      setCargando(false);
    },
    []
  );

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!session) {
          router.replace("/auth/login");
          return;
        }
        setUser({ id: session.user.id, email: session.user.email });
        cargarPartidos(supabase, session.user.id);
      })
      .catch(() => router.replace("/auth/login"));
  }, [router, cargarPartidos]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin text-4xl">⚽</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--primario)]">
            Mis partidos
          </h1>
          {user?.email && (
            <p className="text-[var(--texto)]/50 text-sm">{user.email}</p>
          )}
        </div>
        <button
          onClick={handleLogout}
          className="text-[var(--texto)]/50 text-sm hover:text-[var(--texto)] transition-colors"
        >
          Salir
        </button>
      </div>

      <Link
        href="/organizador/nuevo"
        className="block w-full bg-[var(--primario)] text-[var(--fondo)] font-semibold py-3 px-4 rounded-xl text-center hover:brightness-110 transition-all mb-6"
      >
        + Crear nuevo partido
      </Link>

      {error && (
        <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {partidos.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-4">🏟️</div>
          <p className="text-[var(--texto)]/50">
            Todavía no creaste ningún partido.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {partidos.map((p) => {
            const porEquipo = p.cantidad_jugadores / 2;
            return (
              <Link
                key={p.id}
                href={`/organizador/${p.id}`}
                className="block bg-[var(--superficie)] rounded-xl p-4 hover:brightness-110 transition-all"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--texto)]">
                      {new Date(p.fecha_hora).toLocaleDateString("es-AR", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })}
                    </p>
                    <p className="text-[var(--texto)]/60 text-sm">
                      {new Date(p.fecha_hora).toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {porEquipo}vs{porEquipo}
                    </p>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    {p.resultado_team1 != null && p.resultado_team2 != null && (
                      <p className="text-xl font-bold text-[var(--primario)] mb-1">
                        {p.resultado_team1} - {p.resultado_team2}
                      </p>
                    )}
                    {/* Estado derivado, no el guardado: un partido cuya
                        fecha_hora ya pasó se muestra Cerrado solo. */}
                    <EstadoBadge estado={estadoEfectivo(p)} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
