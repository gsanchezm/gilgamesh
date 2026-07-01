import { useEffect, useRef } from 'react';

// Tool / browser / platform marks that ride the rotating helix (order matches the design prototype).
const HELIX_LOGOS = [
  '/assets/tools/tool-playwright.svg',
  '/assets/tools/tool-appium.png',
  '/assets/tools/tool-gatling.png',
  '/assets/tools/tool-pixelmatch.png',
  '/assets/tools/tool-api.svg',
  '/assets/browsers/browser-chrome.png',
  '/assets/browsers/browser-firefox.png',
  '/assets/platforms/platform-android.svg',
];

interface HelixPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * The shared left-hand hero for the auth screens (Login + Register), ported from the design
 * prototype's `<canvas id="gx-helix">`: a rotating 3D double helix with two depth-shaded strands
 * (z = cos(angle) → front strokes brighter/thicker/glowing, back ones faint), faint rungs, and the
 * tool marks travelling along the strands so they always ride the flow. The phase advances each
 * frame → the helix reads as spinning, not sliding. Kept byte-identical to Login's original hero.
 */
export function AuthHero() {
  const helixRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = helixRef.current;
    if (!cv) return;
    const logos = HELIX_LOGOS.map((src) => {
      const im = new Image();
      im.src = src;
      return im;
    });
    let phase = 0;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const amp = Math.min(w * 0.3, 150);
      const N = 64;
      const turns = 2.4;
      phase += 0.0042;
      const t = phase;
      const cxAt = (p: number) => w * 0.34 + p * w * 0.32; // diagonal axis (incline)
      const p1: HelixPoint[] = [];
      const p2: HelixPoint[] = [];
      for (let i = 0; i <= N; i++) {
        const p = i / N;
        const y = p * h;
        const ang = t + p * turns * Math.PI * 2;
        const cx = cxAt(p);
        p1.push({ x: cx + amp * Math.sin(ang), y, z: Math.cos(ang) });
        p2.push({ x: cx + amp * Math.sin(ang + Math.PI), y, z: Math.cos(ang + Math.PI) });
      }

      // Ladder rungs (the intermediate lines), depth-faded.
      for (let i = 0; i <= N; i += 3) {
        const a = p1[i]!;
        const b = p2[i]!;
        ctx.globalAlpha = 0.05 + 0.12 * (((a.z + b.z) / 2 + 1) / 2);
        ctx.strokeStyle = '#AEB8CC';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // Strands, back segments first then front, so the weave reads as a rotating 3D helix.
      const ribbon = (pts: HelixPoint[], color: string, front: boolean) => {
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i]!;
          const b = pts[i + 1]!;
          const f = ((a.z + 1) / 2 + (b.z + 1) / 2) / 2;
          if (front ? f < 0.5 : f >= 0.5) continue;
          ctx.globalAlpha = 0.16 + 0.66 * f;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.3 + 3.4 * f;
          ctx.shadowColor = color;
          ctx.shadowBlur = 5 + 12 * f;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      };
      ribbon(p1, '#E7C877', false);
      ribbon(p2, '#43B7E8', false);
      ribbon(p2, '#43B7E8', true);
      ribbon(p1, '#E7C877', true);
      ctx.shadowBlur = 0;

      // Tool marks ride the strands; their position along the helix drifts with the phase.
      for (let k = 0; k < logos.length; k++) {
        const pp = ((((k / logos.length) + t * 0.02) % 1) + 1) % 1;
        const idx = Math.min(N, Math.floor(pp * N));
        const pt = (k % 2 ? p2 : p1)[idx];
        if (!pt) continue;
        const f = (pt.z + 1) / 2;
        const r = 12 + 10 * f;
        ctx.globalAlpha = 0.5 + 0.5 * f;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r + 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#0A1626';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(231,200,119,.5)';
        ctx.stroke();
        const im = logos[k];
        if (im && im.complete && im.naturalWidth) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(im, pt.x - r, pt.y - r, r * 2, r * 2);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <aside className="gx-auth__hero" aria-hidden="true">
      <canvas className="gx-auth__helix" ref={helixRef} />
      <div className="gx-auth__brand">
        <div className="gx-auth__mark" style={{ backgroundImage: 'url(/assets/brand/mark-dark.png)' }} />
        <div className="gx-auth__logo">GILGAMESH</div>
        <div className="gx-auth__tagline">Testing · Trusted · Elevated</div>
        <p className="gx-auth__herotext">
          A QA team of agents with real identity, ready to awaken and orchestrate your tests.
        </p>
      </div>
    </aside>
  );
}
