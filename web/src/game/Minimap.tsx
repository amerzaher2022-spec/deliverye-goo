import { useEffect, useMemo, useRef } from 'react';
import { toLocal, type LocalPoint } from '../../../shared/geo';
import type { RoadGraph } from '../../../shared/roads';
import type { DistrictData, Merchant } from '../../../shared/types';
import type { HudState } from './engine';

interface MapProps {
  graph: RoadGraph;
  district: DistrictData;
  merchants: Merchant[];
  featured: Set<number>;
  hud: HudState | null;
  highlight?: number[];
}

function merchantPoints(merchants: Merchant[], district: DistrictData) {
  return merchants.map((m) => ({ m, p: toLocal(m.location, district.origin) }));
}

function drawMap(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  centre: LocalPoint,
  scale: number,
  props: MapProps,
  pts: { m: Merchant; p: LocalPoint }[],
  rotate: number,
) {
  const { graph, hud } = props;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1b1e22';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rotate);
  ctx.scale(scale, -scale);
  ctx.translate(-centre.x, -centre.y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of [0, 1]) {
    for (const { road, points } of graph.polylines) {
      ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = pass ? (road.kind === 'arterial' ? '#5b6068' : '#41454c') : '#2a2d32';
      ctx.lineWidth = Math.max(road.width + (pass ? 0 : 6), 4 / scale);
      ctx.stroke();
    }
  }
  if (hud?.route && hud.route.length > 1) {
    ctx.beginPath();
    hud.route.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = '#f1a540';
    ctx.lineWidth = Math.max(6, 5 / scale);
    ctx.stroke();
  }
  for (const { m, p } of pts) {
    const featured = props.featured.has(m.id) || !!m.sponsorship?.benefits.highlightMarker;
    const r = (featured ? 5.5 : 4) / scale;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = m.category?.color ?? m.brand_color;
    ctx.fill();
    ctx.lineWidth = (featured ? 2 : 1.25) / scale;
    ctx.strokeStyle = featured ? '#f1a540' : 'rgba(243,239,232,0.85)';
    ctx.stroke();
  }
  if (hud?.target) {
    ctx.beginPath();
    ctx.arc(hud.target.x, hud.target.y, 9 / scale, 0, Math.PI * 2);
    ctx.fillStyle = '#1b1e22';
    ctx.fill();
    ctx.lineWidth = 3.5 / scale;
    ctx.strokeStyle = '#f1a540';
    ctx.stroke();
  }
  if (hud) {
    ctx.save();
    ctx.translate(hud.x, hud.y);
    ctx.rotate(-hud.heading);
    ctx.scale(1 / scale, 1 / scale);
    ctx.beginPath();
    ctx.moveTo(0, 11);
    ctx.lineTo(7, -7);
    ctx.lineTo(0, -3);
    ctx.lineTo(-7, -7);
    ctx.closePath();
    ctx.fillStyle = '#f3efe8';
    ctx.strokeStyle = '#1b1e22';
    ctx.lineWidth = 2.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

export function Minimap(props: MapProps & { onOpen: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pts = useMemo(() => merchantPoints(props.merchants, props.district), [props.merchants, props.district]);
  useEffect(() => {
    const c = ref.current;
    if (!c || !props.hud) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth * dpr;
    const h = c.clientHeight * dpr;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    // heading-up, ~220 m across
    drawMap(c.getContext("2d")!, w, h, props.hud, w / 220, props, pts, -props.hud.heading);
  });
  return (
    <button type="button" className="minimap" onClick={props.onOpen} aria-label="map" style={{ padding: 0 }}>
      <canvas ref={ref} />
    </button>
  );
}

export function FullMap(props: MapProps & { onPick: (id: number) => void; onClose: () => void; title: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef<{ scale: number; centre: LocalPoint } | null>(null);
  const pts = useMemo(() => merchantPoints(props.merchants, props.district), [props.merchants, props.district]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    const xs = props.graph.nodes.map((n) => n.x);
    const ys = props.graph.nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const scale = Math.min(c.width / (maxX - minX + 120), c.height / (maxY - minY + 120));
    const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    view.current = { scale, centre };
    drawMap(c.getContext('2d')!, c.width, c.height, centre, scale, props, pts, 0);
  });
  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="sheet fullmap" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="close" style={{ background: 'transparent' }}>
            ✕
          </button>
        </div>
        <canvas
          ref={ref}
          onClick={(e) => {
            const c = ref.current;
            const v = view.current;
            if (!c || !v) return;
            const r = c.getBoundingClientRect();
            const dpr = c.width / r.width;
            const px = (e.clientX - r.left) * dpr - c.width / 2;
            const py = (e.clientY - r.top) * dpr - c.height / 2;
            const at = { x: v.centre.x + px / v.scale, y: v.centre.y - py / v.scale };
            let best: { id: number; d: number } | null = null;
            for (const { m, p } of pts) {
              const d = Math.hypot(p.x - at.x, p.y - at.y);
              if (!best || d < best.d) best = { id: m.id, d };
            }
            if (best && best.d * v.scale < 28 * dpr) props.onPick(best.id);
          }}
        />
      </div>
    </div>
  );
}
