"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function HomePage() {
  const router = useRouter();
  const [mostrarCodigo, setMostrarCodigo] = useState(false);
  const [codigo, setCodigo] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (session) {
          router.replace("/organizador");
        }
      })
      .catch(() => {});
  }, [router]);

  const handleUnirse = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = codigo.trim().toLowerCase();
    if (!slug) return;
    // La validación real (¿existe?, ¿está cerrado?) la hace /unirse/[slug],
    // con el mismo mensaje genérico que si hubiese entrado por link: así
    // probar códigos al azar no distingue "no existe" de "no tenés acceso".
    router.push(`/unirse/${slug}`);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="w-full max-w-sm text-center">
        <div className="text-7xl mb-6">⚽</div>
        <h1 className="text-4xl font-bold text-[var(--primario)]">appFut</h1>
        <p className="text-[var(--texto)]/70 mt-3 text-lg">
          Organiza partidos de fútbol entre amigos.
          <br />
          Gestiona pagos sin efectivo.
        </p>

        <div className="mt-10 space-y-4">
          <Link
            href="/auth/login"
            className="block w-full bg-[var(--primario)] text-[var(--fondo)] font-semibold py-3 px-4 rounded-xl text-center hover:brightness-110 transition-all"
          >
            Soy organizador
          </Link>

          {!mostrarCodigo ? (
            <button
              type="button"
              onClick={() => setMostrarCodigo(true)}
              className="block w-full bg-[var(--superficie)] text-[var(--texto)] font-medium py-3 px-4 rounded-xl text-center hover:brightness-110 transition-all"
            >
              Unirme a un partido
            </button>
          ) : (
            <form onSubmit={handleUnirse} className="space-y-3">
              <input
                type="text"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Código del partido"
                autoFocus
                maxLength={16}
                className="w-full bg-[var(--superficie)] text-[var(--texto)] rounded-xl px-4 py-3 border border-[var(--texto)]/10 focus:border-[var(--primario)] outline-none transition-colors text-center"
              />
              <button
                type="submit"
                disabled={!codigo.trim()}
                className="w-full bg-[var(--primario)] text-[var(--fondo)] font-semibold py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-50"
              >
                Continuar
              </button>
            </form>
          )}

          <p className="text-[var(--texto)]/40 text-sm">
            ¿Te invitaron a un partido?
            <br />
            Usá el link o el código que te enviaron para unirte.
          </p>
        </div>
      </div>
    </div>
  );
}
