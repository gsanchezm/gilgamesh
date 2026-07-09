// Admin nav stroke icons (handoff §7 — no emoji; 1.8px round strokes). Kept inside the admin chunk.
import type { ReactNode } from 'react';

function Svg({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IcResumen = (p: { size?: number }) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);

export const IcIngresos = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M4 19V5M20 19V5" opacity="0" />
    <path d="M3 17l5-5 4 3 8-8" />
    <path d="M15 7h5v5" />
  </Svg>
);

export const IcClientes = (p: { size?: number }) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19a5 5 0 0 0-3-4.6" />
  </Svg>
);

export const IcPlanes = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M12 3 21 12 12 21 3 12 12 3Z" />
  </Svg>
);

export const IcProyectos = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </Svg>
);

export const IcUso = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M4 20V4" opacity="0" />
    <path d="M6 20v-5M12 20v-9M18 20v-13" />
    <path d="M3 20h18" />
  </Svg>
);

export const IcSalud = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M3 12h4l2 6 4-14 2 8h6" />
  </Svg>
);

export const IcUsuarios = (p: { size?: number }) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </Svg>
);

export const IcAuditoria = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M12 3l7 3v5c0 4.4-2.9 8.1-7 9-4.1-.9-7-4.6-7-9V6l7-3Z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);

export const IcFacturacion = (p: { size?: number }) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M3 10h18M7 15h4" />
  </Svg>
);

export const IcAjustes = (p: { size?: number }) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </Svg>
);

export const IcGotoPlatform = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M14 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8" />
    <path d="M18 15l3-3-3-3M21 12H10" />
  </Svg>
);

export const IcChevronDown = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const IcCheck = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M5 12l5 5 9-11" />
  </Svg>
);
