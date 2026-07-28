"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  children: ReactNode;
  titulo?: string;
};

export default function BottomSheet({ abierto, onCerrar, children, titulo }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCerrar}
      />
      <div
        ref={ref}
        className="relative w-full md:max-w-md bg-[var(--superficie)] rounded-t-2xl md:rounded-2xl p-5 shadow-2xl animate-slide-up max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          {titulo && (
            <h3 className="text-lg font-bold text-[var(--texto)]">{titulo}</h3>
          )}
          <button
            onClick={onCerrar}
            className="ml-auto p-2 rounded-full hover:bg-[var(--texto)]/10 transition-colors"
            aria-label="Cerrar"
          >
            <svg className="w-5 h-5 text-[var(--texto)]/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
