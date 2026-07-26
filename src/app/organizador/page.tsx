"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Partido } from "@/lib/db/types";

export default function OrganizadorDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [partidos, setPartidos] = useState<Partido[]>([]);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);

  const cargarPartidos = useCallback(
    async (supabase: ReturnType<typeof createClient>, userId: string) => {
      const { data } = await supabase
        .from("partidos")
        .select("*")
        .eq("organizador_id", userId)
        .order("fecha_hora", { ascending: false });
      if (data) setPartidos(data as Partido[]);
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace("/auth/login");
        return;
      }
      setUser({ id: session.user.id, email: session.user.email });
      cargarPartidos(supabase, session.user.id);
    }).catch(() => {
      router.replace("/auth/login");
    });
  }, [router, cargarPartidos]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
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

      {partidos.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-4">🏟️</div>
          <p className="text-[var(--texto)]/50">
            Todavía no creaste ningún partido.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {partidos.map((p) => (
            <Link
              key={p.id}
              href={`/organizador/${p.id}`}
              className="block bg-[var(--superficie)] rounded-xl p-4 hover:brightness-110 transition-all"
            >
              <div className="flex items-center justify-between">
                <div>
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
                    · {p.cantidad_jugadores}vs{cantidad_jugadores(p)}
                  </p>
                </div>
                <span
                  className={`text-sm font-medium px-2 py-1 rounded-full ${
                    p.estado === "abierto"
                      ? "bg-[var(--primario)]/20 text-[var(--primario)]"
                      : p.estado === "completo"
                      ? "bg-blue-500/20 text-blue-400"
                      : "bg-[var(--inactivo)]/20 text-[var(--inactivo)]"
                  }`}
                >
                  {estadoLabel(p.estado)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function cantidad_jugadores(p: Partido) {
  return p.cantidad_jugadores;
}

function estadoLabel(estado: string) {
  const map: Record<string, string> = {
    abierto: "Abierto",
    completo: "Completo",
    cerrado: "Cerrado",
  };
  return map[estado] ?? estado;
}
