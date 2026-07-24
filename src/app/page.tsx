"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const [autenticado, setAutenticado] = useState<boolean | null>(null);
  console.log("[Home] Render - autenticado:", autenticado);

  useEffect(() => {
    console.log("[Home] useEffect - inicio", Date.now());
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => {
        console.log("[Home] getUser OK - user:", !!data.user, Date.now());
        setAutenticado(!!data.user);
      })
      .catch((err) => {
        console.log("[Home] getUser ERROR:", err?.message || err, Date.now());
        setAutenticado(false);
      });
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="w-full max-w-sm text-center">
        <div className="text-7xl mb-6">⚽</div>
        <p style={{ color: "red", fontSize: 12 }}>PAGE RENDER OK</p>
        <h1 className="text-4xl font-bold text-[var(--primario)]">appFut</h1>
        <p className="text-[var(--texto)]/70 mt-3 text-lg">
          Organiza partidos de fútbol entre amigos.
          <br />
          Gestiona pagos sin efectivo.
        </p>

        <div className="mt-10 space-y-4">
          {autenticado === true ? (
            <Link
              href="/organizador"
              className="block w-full bg-[var(--primario)] text-[var(--fondo)] font-semibold py-3 px-4 rounded-xl text-center hover:brightness-110 transition-all"
            >
              Ir a mis partidos
            </Link>
          ) : autenticado === false ? (
            <Link
              href="/auth/login"
              className="block w-full bg-[var(--primario)] text-[var(--fondo)] font-semibold py-3 px-4 rounded-xl text-center hover:brightness-110 transition-all"
            >
              Soy organizador
            </Link>
          ) : (
            <div className="h-12 bg-[var(--superficie)] rounded-xl animate-pulse" />
          )}

          <p className="text-[var(--texto)]/40 text-sm">
            ¿Te invitaron a un partido?
            <br />
            Usá el link que te enviaron para unirte.
          </p>
        </div>
      </div>
    </div>
  );
}
