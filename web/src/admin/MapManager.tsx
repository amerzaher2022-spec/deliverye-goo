import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { district } from '../../../shared/district';
import { toLatLng, toLocal, type LatLng } from '../../../shared/geo';
import { buildRoadGraph, nearestOnNetwork } from '../../../shared/roads';
import type { Merchant } from '../../../shared/types';
import { useI18n } from '../i18n';
import { Icon } from '../icons';
import { StatusBadge, pointLabel, useAdminData, useL } from './common';
import { MerchantEditor, emptyDraft, type Draft, type PointKey } from './MerchantEditor';

const graph = buildRoadGraph(district);
const DEPTH: Record<string, number> = { restaurant: 14, shop: 14, factory: 42, warehouse: 36, office: 22 };

/** Derive entrance and kerbside pickup from a building position and its nearest road. */
export function snapToRoad(location: LatLng, buildingType: string): { location: LatLng; entrance: LatLng; pickup: LatLng } {
  const p = toLocal(location, district.origin);
  const near = nearestOnNetwork(graph, p);
  if (!near) return { location, entrance: location, pickup: location };
  let dx = near.point.x - p.x;
  let dy = near.point.y - p.y;
  let d = Math.hypot(dx, dy);
  if (d < 0.01) {
    // exactly on the centreline: pick the left-hand side of the road
    const s = near.segment;
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) || 1;
    dx = (s.b.y - s.a.y) / len;
    dy = -(s.b.x - s.a.x) / len;
    d = 0;
  } else {
    dx /= d;
    dy /= d;
  }
  const depth = DEPTH[buildingType] ?? 14;
  const half = near.segment.width / 2;
  const minFront = half + 7;
  // keep the building off the road: front face at least `minFront` from the centreline
  const front = Math.max(d - depth / 2, minFront);
  const centre = { x: near.point.x - dx * (front + depth / 2), y: near.point.y - dy * (front + depth / 2) };
  const entrance = { x: near.point.x - dx * front, y: near.point.y - dy * front };
  const kerb = { x: near.point.x - dx * (half + 3), y: near.point.y - dy * (half + 3) };
  return {
    location: toLatLng(centre, district.origin),
    entrance: toLatLng(entrance, district.origin),
    pickup: toLatLng(kerb, district.origin),
  };
}

interface SearchHit {
  label: string;
  sub: string;
  lat: number;
  lng: number;
  merchantId?: number;
}

const POINT_STYLE: Record<PointKey, { color: string; letter: string }> = {
  location: { color: '#1f2023', letter: 'B' },
  entrance: { color: '#1f6fd1', letter: 'E' },
  pickup: { color: '#16a34a', letter: 'P' },
  dropoff: { color: '#ea580c', letter: 'D' },
};

export function MapManager({ initialSelect }: { initialSelect: number | null }) {
  const { lang, pick } = useI18n();
  const L_ = useL();
  const data = useAdminData();
  const mapDiv = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markerLayer = useRef<L.LayerGroup | null>(null);
  const draftLayer = useRef<L.LayerGroup | null>(null);
  const [selected, setSelected] = useState<number | null>(initialSelect);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tool, setTool] = useState<PointKey | null>(null);
  const [placing, setPlacing] = useState(false);
  const [filters, setFilters] = useState({ category: 'all', sponsor: 'all', status: 'live', q: '' });
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  // latest values for Leaflet event handlers
  const live = useRef({ tool, placing, draft, categories: data.categories });
  live.current = { tool, placing, draft, categories: data.categories };

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return data.merchants.filter((m) => {
      if (filters.status === 'live' && m.status === 'archived') return false;
      if (filters.status !== 'live' && filters.status !== 'all' && m.status !== filters.status) return false;
      if (filters.category !== 'all' && String(m.category_id) !== filters.category) return false;
      if (filters.sponsor === 'sponsored' && !m.sponsorship) return false;
      if (filters.sponsor === 'none' && m.sponsorship) return false;
      if (q && !`${m.name_ar} ${m.name_en} ${m.code}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data.merchants, filters]);

  // ---- map setup ----------------------------------------------------------------
  useEffect(() => {
    if (!mapDiv.current || map.current) return;
    const b = district.bounds;
    const m = L.map(mapDiv.current, { zoomControl: true, attributionControl: true }).fitBounds([
      [b.south, b.west],
      [b.north, b.east],
    ]);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    // the game's road network, so the map is useful even if tiles cannot load
    for (const road of district.roads) {
      L.polyline(road.coords as [number, number][], {
        color: road.kind === 'arterial' ? '#f59e0b' : '#64748b',
        weight: road.kind === 'arterial' ? 6 : 4,
        opacity: 0.75,
      })
        .bindTooltip(`${road.name_ar} · ${road.name_en}`, { sticky: true })
        .addTo(m);
    }
    L.rectangle(
      [
        [b.south, b.west],
        [b.north, b.east],
      ],
      { color: '#1f6fd1', weight: 2, dashArray: '6 6', fill: false, interactive: false },
    ).addTo(m);
    markerLayer.current = L.layerGroup().addTo(m);
    draftLayer.current = L.layerGroup().addTo(m);
    m.on('mousemove', (e: L.LeafletMouseEvent) => setCursor({ lat: e.latlng.lat, lng: e.latlng.lng }));
    m.on('click', (e: L.LeafletMouseEvent) => {
      const at = { lat: e.latlng.lat, lng: e.latlng.lng };
      setCursor(at);
      const { tool: t, placing: p, draft: d, categories } = live.current;
      if (p) {
        const base = emptyDraft(categories[0]?.id ?? 0, categories[0]?.default_building_type ?? 'restaurant');
        const snapped = snapToRoad(at, base.building_type);
        setDraft({ ...base, ...snapped, dropoff: snapped.pickup });
        setSelected(null);
        setPlacing(false);
        setTool(null);
        return;
      }
      if (t && d) {
        setDraft({ ...d, [t]: at, ...(t === 'pickup' && sameish(d.pickup, d.dropoff) ? { dropoff: at } : {}) });
      }
    });
    map.current = m;
    (window as unknown as { __dgMap: L.Map }).__dgMap = m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.loaded]);

  useEffect(() => () => {
    map.current?.remove();
    map.current = null;
  }, []);

  // ---- merchant markers -----------------------------------------------------------
  useEffect(() => {
    const layer = markerLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const m of visible) {
      if (draft && draft.id === m.id) continue;
      const cls = ['pin', m.sponsorship ? 'sponsored' : '', m.status !== 'active' ? 'disabled' : '', selected === m.id ? 'selected' : ''].join(' ');
      const icon = L.divIcon({
        className: '',
        html: `<div class="${cls}" style="background:${m.category?.color ?? m.brand_color}" data-merchant="${m.id}"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      L.marker([m.location.lat, m.location.lng], { icon, title: `${m.name_ar} · ${m.name_en}` })
        .on('click', () => {
          setSelected(m.id);
          setDraft(null);
          setTool(null);
        })
        .bindTooltip(pick(m.name_ar, m.name_en), { direction: 'top', offset: [0, -10] })
        .addTo(layer);
    }
  }, [visible, selected, draft, pick]);

  // ---- draft markers (draggable points) ---------------------------------------------
  useEffect(() => {
    const layer = draftLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (!draft) return;
    for (const k of ['entrance', 'pickup', 'dropoff'] as const) {
      L.polyline(
        [
          [draft.location.lat, draft.location.lng],
          [draft[k].lat, draft[k].lng],
        ],
        { color: POINT_STYLE[k].color, weight: 2, dashArray: '4 4' },
      ).addTo(layer);
    }
    for (const k of ['location', 'entrance', 'pickup', 'dropoff'] as const) {
      const st = POINT_STYLE[k];
      const icon = L.divIcon({
        className: '',
        html: `<div class="pt" style="background:${st.color}" data-point="${k}">${st.letter}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      L.marker([draft[k].lat, draft[k].lng], { icon, draggable: true, zIndexOffset: k === 'location' ? 1000 : 500 })
        .on('dragend', (e) => {
          const ll = (e.target as L.Marker).getLatLng();
          setDraft((d) => (d ? { ...d, [k]: { lat: ll.lat, lng: ll.lng } } : d));
        })
        .addTo(layer);
    }
  }, [draft]);

  useEffect(() => {
    if (!map.current) return;
    map.current.getContainer().style.cursor = placing || tool ? 'crosshair' : '';
  }, [placing, tool]);

  // select from outside (e.g. "edit on map" in the merchants table)
  useEffect(() => {
    if (initialSelect === null) return;
    const m = data.merchants.find((x) => x.id === initialSelect);
    if (m && map.current) map.current.setView([m.location.lat, m.location.lng], 18);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelect, data.loaded]);

  const selectedMerchant = selected !== null ? data.merchants.find((m) => m.id === selected) : undefined;

  const startEdit = (m: Merchant) => {
    setDraft({
      id: m.id,
      name_ar: m.name_ar,
      name_en: m.name_en,
      category_id: m.category_id,
      description_ar: m.description_ar,
      description_en: m.description_en,
      address_ar: m.address_ar,
      address_en: m.address_en,
      location: m.location,
      entrance: m.entrance,
      pickup: m.pickup,
      dropoff: m.dropoff,
      building_type: m.building_type,
      sign_size: m.sign_size,
      sign_position: m.sign_position,
      brand_color: m.brand_color,
      hours: m.hours ?? { open: '09:00', close: '22:00', days: '' },
      hoursEnabled: !!m.hours,
      phone: m.phone,
      website: m.website,
      interior_enabled: m.interior_enabled,
      notes: m.notes ?? '',
      menu: m.menu.map((i) => ({ ...i, description_ar: i.description_ar ?? '', description_en: i.description_en ?? '' })),
    });
    setTool(null);
    map.current?.setView([m.location.lat, m.location.lng], Math.max(map.current.getZoom(), 17));
  };

  // ---- search ------------------------------------------------------------------------
  const runSearch = async () => {
    const q = query.trim();
    if (!q) return setHits(null);
    const needle = q.toLowerCase();
    const local: SearchHit[] = [
      ...district.landmarks
        .filter((l) => `${l.name_ar} ${l.name_en}`.toLowerCase().includes(needle))
        .map((l) => ({ label: pick(l.name_ar, l.name_en), sub: L_('معلم في منطقة اللعب', 'Landmark in the game district'), lat: l.lat, lng: l.lng })),
      ...district.roads
        .filter((r) => `${r.name_ar} ${r.name_en}`.toLowerCase().includes(needle))
        .map((r) => {
          const mid = r.coords[Math.floor(r.coords.length / 2)]!;
          return { label: pick(r.name_ar, r.name_en), sub: L_('شارع في منطقة اللعب', 'Street in the game district'), lat: mid[0], lng: mid[1] };
        }),
      ...data.merchants
        .filter((m) => `${m.name_ar} ${m.name_en}`.toLowerCase().includes(needle))
        .map((m) => ({ label: pick(m.name_ar, m.name_en), sub: L_('نشاط تجاري', 'Business'), lat: m.location.lat, lng: m.location.lng, merchantId: m.id })),
    ];
    setHits(local);
    setSearching(true);
    try {
      const b = district.bounds;
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=${lang},en&viewbox=${b.west - 0.05},${b.north + 0.05},${b.east + 0.05},${b.south - 0.05}&q=${encodeURIComponent(`${q}, Erbil`)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const rows = (await res.json()) as { display_name: string; lat: string; lon: string; type: string }[];
        setHits([
          ...local,
          ...rows.map((r) => ({ label: r.display_name.split(',').slice(0, 2).join('،'), sub: `OpenStreetMap · ${r.type}`, lat: +r.lat, lng: +r.lon })),
        ]);
      }
    } catch {
      /* offline or blocked: local results only */
    } finally {
      setSearching(false);
    }
  };

  const modeText = placing
    ? L_('انقر على الخريطة لتحديد موقع النشاط الجديد', 'Click the map to place the new business')
    : tool
      ? L_(`انقر على الخريطة لتحديد: ${pointLabel(tool, 'ar')}`, `Click the map to set: ${pointLabel(tool, 'en')}`)
      : null;

  return (
    <div className="mapmgr" data-testid="map-manager">
      <div className="map-wrap">
        <div ref={mapDiv} data-testid="leaflet-map" />
        <div className="map-tools">
          <form
            className="map-search"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            <input
              className="a-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={L_('ابحث عن شارع أو مكان… (مثال: الستين)', 'Search a street or place… (e.g. Sixty Meter)')}
              data-testid="map-search"
            />
            <button className="a-btn primary" type="submit">
              {searching ? '…' : L_('بحث', 'Search')}
            </button>
          </form>
          {hits && (
            <div className="search-results" data-testid="search-results">
              {hits.length === 0 && <div style={{ padding: 8 }}>{L_('لا نتائج', 'No results')}</div>}
              {hits.map((h, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    map.current?.setView([h.lat, h.lng], 17);
                    if (h.merchantId) setSelected(h.merchantId);
                    setHits(null);
                  }}
                >
                  <b>{h.label}</b>
                  <div className="small" style={{ color: 'var(--a-muted)' }}>
                    {h.sub}
                  </div>
                </button>
              ))}
            </div>
          )}
          {modeText && <div className="map-mode">{modeText}</div>}
        </div>
        <div className="map-legend">
          <span>
            <i className="dot-legend" style={{ background: '#f59e0b' }} /> {L_('شوارع اللعبة', 'Game roads')}
          </span>
          <span>
            <i className="dot-legend" style={{ background: '#1f6fd1', borderRadius: 0, height: 2 }} /> {L_('حدود منطقة اللعب', 'Playable area')}
          </span>
        </div>
        {cursor && (
          <div className="map-coords" dir="ltr" data-testid="cursor-coords">
            {cursor.lat.toFixed(6)}, {cursor.lng.toFixed(6)}
          </div>
        )}
      </div>

      <div className="side">
        {draft ? (
          <MerchantEditor
            draft={draft}
            setDraft={setDraft}
            tool={tool}
            setTool={setTool}
            onSnap={() => setDraft((d) => (d ? { ...d, ...snapToRoad(d.location, d.building_type), dropoff: snapToRoad(d.location, d.building_type).pickup } : d))}
            onDone={(m) => {
              setDraft(null);
              setTool(null);
              if (m) setSelected(m.id);
            }}
          />
        ) : (
          <>
            <div className="a-card">
              <div className="a-row">
                <h2 style={{ margin: 0 }}>{L_('الأنشطة على الخريطة', 'Businesses on the map')}</h2>
                <span className="a-spacer" />
                <button
                  className={`a-btn ${placing ? 'on' : 'primary'}`}
                  onClick={() => {
                    setPlacing(!placing);
                    setSelected(null);
                  }}
                  data-testid="add-merchant"
                >
                  {placing ? L_('إلغاء', 'Cancel') : <><Icon name="plus" size={15} /> {L_('إضافة نشاط', 'Add business')}</>}
                </button>
              </div>
              <div className="a-grid" style={{ marginTop: 10, gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <select className="a-input" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} aria-label="category">
                  <option value="all">{L_('كل التصنيفات', 'All categories')}</option>
                  {data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {pick(c.name_ar, c.name_en)}
                    </option>
                  ))}
                </select>
                <select className="a-input" value={filters.sponsor} onChange={(e) => setFilters({ ...filters, sponsor: e.target.value })} aria-label="sponsorship">
                  <option value="all">{L_('كل الرعايات', 'Any sponsorship')}</option>
                  <option value="sponsored">{L_('برعاية فعّالة', 'Sponsored now')}</option>
                  <option value="none">{L_('بدون رعاية', 'Not sponsored')}</option>
                </select>
                <select className="a-input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="status">
                  <option value="live">{L_('فعّال ومعطّل', 'Active & disabled')}</option>
                  <option value="active">{L_('فعّال', 'Active')}</option>
                  <option value="disabled">{L_('معطّل', 'Disabled')}</option>
                  <option value="archived">{L_('مؤرشف', 'Archived')}</option>
                  <option value="all">{L_('الكل', 'All')}</option>
                </select>
                <input className="a-input" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder={L_('بحث في القائمة', 'Filter list')} />
              </div>
            </div>

            {selectedMerchant && (
              <div className="a-card" data-testid="selected-merchant">
                <div className="a-row">
                  {selectedMerchant.logo_url && <img className="a-logo" src={selectedMerchant.logo_url} alt="" />}
                  <div>
                    <b>{pick(selectedMerchant.name_ar, selectedMerchant.name_en)}</b>
                    <div className="small" style={{ color: 'var(--a-muted)' }}>
                      {selectedMerchant.code} · {pick(selectedMerchant.category?.name_ar, selectedMerchant.category?.name_en)}
                    </div>
                  </div>
                  <span className="a-spacer" />
                  <StatusBadge status={selectedMerchant.status} />
                </div>
                <div className="small" dir="ltr" style={{ marginTop: 6, color: 'var(--a-muted)' }}>
                  {selectedMerchant.location.lat.toFixed(6)}, {selectedMerchant.location.lng.toFixed(6)}
                </div>
                {selectedMerchant.sponsorship && (
                  <div style={{ marginTop: 6 }}>
                    <span className="a-badge gold">
                      <Icon name="star" size={12} /> {pick(selectedMerchant.sponsorship.package_name_ar, selectedMerchant.sponsorship.package_name_en)} · {selectedMerchant.sponsorship.ends_on}
                    </span>
                  </div>
                )}
                <div className="a-row" style={{ marginTop: 10 }}>
                  <button className="a-btn primary" onClick={() => startEdit(selectedMerchant)} data-testid="edit-merchant">
                    <Icon name="edit" size={15} /> {L_('تعديل / نقل', 'Edit / move')}
                  </button>
                  <a className="a-btn" href={`/?focus=${selectedMerchant.id}`} target="_blank" rel="noreferrer">
                    <Icon name="gamepad" size={15} /> {L_('عرض في اللعبة', 'View in game')}
                  </a>
                </div>
              </div>
            )}

            <div className="a-card merchant-list" style={{ padding: 6 }}>
              {visible.map((m) => (
                <button
                  key={m.id}
                  className={selected === m.id ? 'on' : ''}
                  onClick={() => {
                    setSelected(m.id);
                    map.current?.setView([m.location.lat, m.location.lng], Math.max(map.current.getZoom(), 17));
                  }}
                >
                  {m.logo_url ? <img className="a-logo" src={m.logo_url} alt="" /> : <span className="a-logo" />}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b>{pick(m.name_ar, m.name_en)}</b>
                    <span className="small" style={{ display: 'block', color: 'var(--a-muted)' }}>
                      {pick(m.category?.name_ar, m.category?.name_en)}
                    </span>
                  </span>
                  {m.sponsorship && <span className="a-badge gold"><Icon name="star" size={12} /></span>}
                  <StatusBadge status={m.status} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function sameish(a: LatLng, b: LatLng) {
  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;
}
