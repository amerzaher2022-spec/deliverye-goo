// A merchant's presence in the 3D world, built entirely from its saved record:
// position, entrance (which way the building faces), pickup point, building
// type, sign size/position, brand colour, logo and sponsorship benefits.
// Rebuilt whenever the record changes, so dashboard edits show up live.

import * as THREE from 'three';
import { toLocal, type LocalPoint } from '../../../shared/geo';
import { nearestOnNetwork, type RoadGraph } from '../../../shared/roads';
import type { BuildingType, DistrictData, Merchant } from '../../../shared/types';
import type { Box } from './collision';
import { disposeOwned, person, type PersonId } from './assets';
import { MAT, bakeStatic, pedestrian } from './models';
import { v3 } from './world';
import { facadeTexture, hazardTexture, loadImage, pinTexture, shade, signTexture, stripeTexture } from './textures';

export const BUILDING_SIZE: Record<BuildingType, { w: number; d: number; h: number }> = {
  restaurant: { w: 16, d: 14, h: 10.8 },
  shop: { w: 18, d: 14, h: 10.8 },
  factory: { w: 52, d: 42, h: 13 },
  warehouse: { w: 46, d: 36, h: 11 },
  office: { w: 22, d: 22, h: 46 },
};

const SIGN_SCALE = { small: 0.75, medium: 1, large: 1.3 } as const;

export interface MerchantFrame {
  centre: LocalPoint;
  front: LocalPoint;
  entrance: LocalPoint;
  pickup: LocalPoint;
  dropoff: LocalPoint;
  box: Box;
}

/** Where the building stands and which way it faces, from the saved coordinates. */
export function merchantFrame(m: Merchant, district: DistrictData, graph: RoadGraph): MerchantFrame {
  const o = district.origin;
  const centre = toLocal(m.location, o);
  const entrance = toLocal(m.entrance, o);
  let fx = entrance.x - centre.x;
  let fy = entrance.y - centre.y;
  if (Math.hypot(fx, fy) < 0.5) {
    // no distinct entrance: face the nearest road
    const near = nearestOnNetwork(graph, centre);
    fx = (near?.point.x ?? centre.x) - centre.x;
    fy = (near?.point.y ?? centre.y + 1) - centre.y;
  }
  const len = Math.hypot(fx, fy) || 1;
  const front = { x: fx / len, y: fy / len };
  const size = BUILDING_SIZE[m.building_type];
  return {
    centre,
    front,
    entrance,
    pickup: toLocal(m.pickup, o),
    dropoff: toLocal(m.dropoff, o),
    box: { cx: centre.x, cy: centre.y, ux: front.y, uy: -front.x, hw: size.w / 2, hd: size.d / 2, id: `m${m.id}` },
  };
}

const lambert = (color: string | number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A facade material tiled to real-world size (bay × storey). */
function facade(style: 'plaster' | 'glass' | 'industrial' | 'shopfront', w: number, h: number, bay: number, floor: number, tint = '#ffffff') {
  const t = facadeTexture(style);
  t.repeat.set(Math.max(1, Math.round(w / bay)), Math.max(1, Math.round(h / floor)));
  return new THREE.MeshLambertMaterial({ map: t, color: tint });
}

export class MerchantView {
  readonly group = new THREE.Group();
  readonly frame: MerchantFrame;
  private marker: THREE.Object3D | null = null;
  private pin: THREE.Sprite | null = null;
  private pickupRing: THREE.Mesh;
  private disposed = false;

  constructor(
    readonly merchant: Merchant,
    district: DistrictData,
    graph: RoadGraph,
    private quality: 'low' | 'medium' | 'high',
  ) {
    this.frame = merchantFrame(merchant, district, graph);
    const f = this.frame;
    // the building group lives in its own frame: +Z points out of the front door
    const body = new THREE.Group();
    body.position.copy(v3(f.centre));
    body.rotation.y = Math.atan2(f.front.x, -f.front.y);
    this.group.add(body);
    this.buildBody(body);
    bakeStatic(body);

    // pickup bay marking on the kerb
    const ringMat = new THREE.MeshBasicMaterial({ color: '#f3efe8', transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    this.pickupRing = new THREE.Mesh(new THREE.RingGeometry(2.5, 2.75, 48), ringMat);
    this.pickupRing.rotation.x = -Math.PI / 2;
    this.pickupRing.position.copy(v3(f.pickup, 0.16));
    this.group.add(this.pickupRing);

    const benefits = merchant.sponsorship?.benefits;
    if (benefits?.highlightMarker) this.addPin();
    if (benefits?.loadingZoneBranding || merchant.building_type === 'warehouse' || merchant.building_type === 'factory') {
      this.addLoadingZone(!!benefits?.loadingZoneBranding);
    }
    if (benefits?.districtSponsor) this.addBillboard();

    this.group.traverse((o) => {
      o.userData.merchantId = merchant.id;
    });
  }

  private brand() {
    return this.merchant.brand_color || '#1d4ed8';
  }

  private buildBody(g: THREE.Group) {
    const t = this.merchant.building_type;
    const { w, d, h } = BUILDING_SIZE[t];
    if (t === 'office') {
      // stone podium, curtain-wall tower, canopy, flagpoles
      g.add(box(w + 1, 5, d + 1, facade('plaster', w + 1, 5, 6, 5, '#d8d0c2'), 0, 2.5, 0));
      g.add(box(w, h - 5, d, facade('glass', w, h - 5, 3, 3.6), 0, 5 + (h - 5) / 2, 0));
      g.add(box(w + 0.5, 0.9, d + 0.5, lambert('#8f969c'), 0, h + 0.45, 0));
      g.add(box(10, 0.35, 4.2, MAT.plastic('#2a2d31'), 0, 4.1, d / 2 + 2.6));
      g.add(box(8, 3.4, 0.15, new THREE.MeshStandardMaterial({ color: '#1a2026', metalness: 0.8, roughness: 0.15 }), 0, 1.7, d / 2 + 0.6));
      for (const x of [-5.5, 0, 5.5]) g.add(this.flagpole(x, d / 2 + 7));
    } else if (t === 'factory') {
      const clad = facade('industrial', w, h, 8, 40, '#e6e4df');
      g.add(box(w, h, d, clad, 0, h / 2, 0));
      // saw-tooth north-light roof
      const tooth = new THREE.CylinderGeometry(0.01, 3.2, w, 3, 1);
      tooth.rotateZ(Math.PI / 2);
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(tooth, lambert('#8d969c'));
        m.position.set(0, h + 1.5, -d / 2 + 4 + (i * (d - 8)) / 4);
        m.castShadow = true;
        g.add(m);
      }
      const chimney = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.4, 24, 14), lambert('#a8a49c'));
      chimney.position.set(w / 2 - 6, 12, -d / 2 + 6);
      chimney.castShadow = true;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.03, 1.03, 1.2, 14), lambert(shade(this.brand(), -0.2)));
      band.position.set(w / 2 - 6, 21.5, -d / 2 + 6);
      g.add(chimney, band);
      // office annex with glazing, gate posts, roller doors
      g.add(box(16, 6.6, 9, facade('plaster', 16, 6.6, 6, 3.3, '#ebe5d9'), -w / 2 + 10, 3.3, d / 2 + 4.5));
      for (const x of [6, 18]) g.add(box(0.8, 2.6, 0.8, lambert('#6b7177'), x, 1.3, d / 2 + 15));
      const door = stripeTexture('#9aa2a8', '#8b939a');
      door.repeat.set(1, 10);
      g.add(box(9, 7, 0.3, new THREE.MeshLambertMaterial({ map: door }), 12, 3.5, d / 2 + 0.16));
      g.add(box(0.12, 13, d + 0.2, lambert(shade(this.brand(), -0.15)), w / 2 + 0.02, h / 2, 0));
    } else if (t === 'warehouse') {
      g.add(box(w, h, d, facade('industrial', w, h, 8, 40, '#e4e2dc'), 0, h / 2, 0));
      g.add(box(w + 0.6, 1.4, d + 0.6, lambert(shade(this.brand(), -0.1)), 0, h + 0.1, 0));
      const doorTex = stripeTexture('#a3abb1', '#959da4');
      doorTex.repeat.set(1, 8);
      const doorMat = new THREE.MeshLambertMaterial({ map: doorTex });
      const frameMat = MAT.plastic('#3a3d41');
      for (const x of [-14, 0, 14]) {
        g.add(box(9, 6.4, 0.3, frameMat, x, 3.2, d / 2 + 0.1));
        g.add(box(8, 5.8, 0.4, doorMat, x, 2.9, d / 2 + 0.2));
        for (const bx of [-3.6, 3.6]) g.add(box(0.5, 0.6, 0.4, MAT.plastic('#141516'), x + bx, 1.4, d / 2 + 4.2));
      }
      g.add(box(w - 4, 1.2, 4, lambert('#9fa3a6'), 0, 0.6, d / 2 + 2));
      g.add(box(16, 0.3, 3, MAT.plastic('#2a2d31'), -w / 2 + 10, 4.6, d / 2 + 1.5));
    } else {
      // restaurant / shop: shop floor + two storeys of plaster
      const upper = h - 4.4;
      g.add(box(w, upper, d, facade('plaster', w, upper, 6, 3.3, '#efe8da'), 0, 4.4 + upper / 2, 0));
      g.add(box(w, 4.4, d, lambert('#d7d1c6'), 0, 2.2, 0));
      g.add(box(w + 0.5, 0.6, d + 0.5, lambert('#bdb5a8'), 0, h + 0.3, 0));
      g.add(box(w + 0.3, 0.25, d + 0.3, lambert('#cfc8bc'), 0, 4.45, 0));
      // aluminium-framed glazing with a warm lit interior
      const glass = new THREE.MeshStandardMaterial({ color: '#2a3138', metalness: 0.7, roughness: 0.12, emissive: '#5a3e1c', emissiveIntensity: 0.35 });
      g.add(box(w - 2, 3.1, 0.12, glass, 0, 1.75, d / 2 + 0.06));
      const alu = lambert('#b5b9bc');
      g.add(box(w - 1.6, 0.14, 0.18, alu, 0, 3.35, d / 2 + 0.1), box(w - 1.6, 0.14, 0.18, alu, 0, 0.18, d / 2 + 0.1));
      for (let x = -w / 2 + 1; x <= w / 2 - 1; x += (w - 2) / 4) g.add(box(0.12, 3.2, 0.18, alu, x, 1.75, d / 2 + 0.1));
      g.add(box(2, 2.7, 0.2, new THREE.MeshStandardMaterial({ color: '#1b1e21', metalness: 0.6, roughness: 0.25 }), w / 2 - 3, 1.35, d / 2 + 0.14));
      if (t === 'restaurant') {
        const tex = stripeTexture(shade(this.brand(), -0.3), '#ece6dc');
        tex.repeat.set((w - 1) / 2.4, 1);
        const awning = new THREE.Mesh(new THREE.BoxGeometry(w - 1, 0.08, 2.2), new THREE.MeshLambertMaterial({ map: tex }));
        awning.position.set(0, 3.75, d / 2 + 1.05);
        awning.rotation.x = 0.26;
        awning.castShadow = true;
        g.add(awning);
        if (this.quality !== 'low') {
          const top = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16);
          const leg = new THREE.CylinderGeometry(0.03, 0.03, 0.74, 6);
          for (const x of [-4.5, -1.5, 1.5]) {
            const tt = new THREE.Mesh(top, MAT.plastic('#2a2c2f'));
            tt.position.set(x, 0.76, d / 2 + 3.6);
            const l = new THREE.Mesh(leg, MAT.plastic('#2a2c2f'));
            l.position.set(x, 0.37, d / 2 + 3.6);
            g.add(tt, l);
            for (const cz of [-0.65, 0.65]) g.add(box(0.42, 0.45, 0.42, MAT.plastic('#3a3d41'), x, 0.23, d / 2 + 3.6 + cz));
          }
        }
      }
      // a couple of window AC units on the upper floors
      for (const x of [-w / 2 + 2.2, w / 2 - 2.2]) g.add(box(0.9, 0.55, 0.4, lambert('#d4d5d2'), x, 8.5, d / 2 + 0.25));
      if (this.merchant.sponsorship?.benefits.enhancedSignage) for (const x of [-w / 2 - 0.6, w / 2 + 0.6]) g.add(this.flagpole(x, d / 2 + 3));
    }
    this.addSign(g, w, d, h);
  }

  private flagpole(x: number, z: number) {
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 8, 8), MAT.rim());
    pole.position.set(0, 4, 0);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.4), new THREE.MeshLambertMaterial({ color: this.brand(), side: THREE.DoubleSide }));
    cloth.position.set(0.68, 6.6, 0);
    grp.add(pole, cloth);
    grp.position.set(x, 0, z);
    return grp;
  }

  /** Lightbox: a slim box with the painted sign on its face. */
  private lightbox(width: number) {
    const height = width / 4;
    const grp = new THREE.Group();
    const faceMat = new THREE.MeshBasicMaterial({ color: this.brand() });
    faceMat.userData.unique = true;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), faceMat);
    face.position.z = 0.16;
    const back = new THREE.Mesh(new THREE.BoxGeometry(width + 0.12, height + 0.12, 0.3), MAT.plastic('#2a2c2f'));
    grp.add(back, face);
    void loadImage(this.merchant.logo_url).then((logo) => {
      if (this.disposed) return;
      const { texture } = signTexture({ nameAr: this.merchant.name_ar, nameEn: this.merchant.name_en, color: this.brand(), logo });
      faceMat.map = texture;
      faceMat.color.set('#ffffff');
      faceMat.needsUpdate = true;
    });
    return grp;
  }

  private addSign(g: THREE.Group, w: number, d: number, h: number) {
    const scale = SIGN_SCALE[this.merchant.sign_size] * (this.merchant.sponsorship?.benefits.signScale ?? 1);
    const pos = this.merchant.sign_position;
    const big = ['factory', 'warehouse', 'office'].includes(this.merchant.building_type);
    if (pos === 'front' && !big) {
      const width = Math.min(w - 1.5, 9.5 * scale);
      const sign = this.lightbox(width);
      // fascia band between the shop floor and the first floor
      sign.position.set(0, Math.max(5.3, 4.5 + width / 8 + 0.1), d / 2 + 0.05);
      g.add(sign);
    } else if (pos === 'pylon') {
      const width = 6.5 * scale;
      const poleH = 5.5 + width / 4;
      const grp = new THREE.Group();
      grp.add(box(0.5, poleH, 0.5, MAT.plastic('#3a3d41'), 0, poleH / 2, 0));
      const front = this.lightbox(width);
      front.position.set(0, poleH + width / 8, 0.2);
      const rear = this.lightbox(width);
      rear.position.set(0, poleH + width / 8, -0.2);
      rear.rotation.y = Math.PI;
      grp.add(front, rear);
      grp.position.set(w / 2 + 2.5, 0, d / 2 + 6);
      g.add(grp);
    } else {
      // roof-mounted letters on a frame (also used for tall buildings with a front sign)
      const width = Math.min(Math.max(w - 2, 8), (big ? 22 : 12) * scale);
      const sign = this.lightbox(width);
      sign.position.set(0, h + width / 8 + 1.2, d / 2 - 1.5);
      g.add(sign);
      for (const x of [-width / 3, width / 3]) g.add(box(0.15, 1.2, 0.15, MAT.rim(), x, h + 0.6, d / 2 - 1.7));
    }
  }

  private addPin() {
    const mat = new THREE.SpriteMaterial({ color: '#ffffff', depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(5, 5, 1);
    const h = BUILDING_SIZE[this.merchant.building_type].h;
    sprite.position.copy(v3(this.frame.centre, h + (this.merchant.building_type === 'office' ? 9 : 7.5)));
    void loadImage(this.merchant.logo_url).then((img) => {
      if (this.disposed) return;
      mat.map = pinTexture(img, '#e38b1d');
      mat.needsUpdate = true;
    });
    this.pin = sprite;
    this.group.add(sprite);
  }

  private addLoadingZone(branded: boolean) {
    const p = this.frame.pickup;
    const tex = hazardTexture();
    const zone = new THREE.Mesh(new THREE.RingGeometry(3.4, 3.9, 4, 1), new THREE.MeshLambertMaterial({ map: tex }));
    zone.rotation.x = -Math.PI / 2;
    zone.rotation.z = Math.atan2(this.frame.front.y, this.frame.front.x) + Math.PI / 4;
    zone.position.copy(v3(p, 0.14));
    this.group.add(zone);
    if (branded) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, color: '#ffffff' });
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), mat);
      decal.rotation.x = -Math.PI / 2;
      decal.position.copy(v3(p, 0.18));
      void loadImage(this.merchant.logo_url).then((img) => {
        if (!img || this.disposed) return;
        const t = new THREE.Texture(img);
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        mat.map = t;
        mat.needsUpdate = true;
      });
      this.group.add(decal);
    }
  }

  private addBillboard() {
    const f = this.frame;
    const side = { x: -f.front.y, y: f.front.x };
    const at = { x: f.pickup.x + side.x * 12 - f.front.x * 2, y: f.pickup.y + side.y * 12 - f.front.y * 2 };
    const grp = new THREE.Group();
    grp.position.copy(v3(at));
    grp.rotation.y = Math.atan2(f.front.x, -f.front.y);
    grp.add(box(0.45, 7, 0.45, MAT.plastic('#3a3d41'), -3, 3.5, 0), box(0.45, 7, 0.45, MAT.plastic('#3a3d41'), 3, 3.5, 0));
    const sign = this.lightbox(10);
    sign.position.set(0, 8.2, 0);
    grp.add(sign);
    this.group.add(grp);
  }

  /** Mission marker over this merchant's pickup/drop-off point. */
  setTarget(kind: 'pickup' | 'dropoff' | null) {
    if (this.marker) {
      this.group.remove(this.marker);
      disposeOwned(this.marker);
      this.marker = null;
    }
    if (!kind) return;
    const f = this.frame;
    this.marker = targetBeacon(kind, kind === 'pickup' ? f.pickup : f.dropoff, this.brand(), roleFor(this.merchant, kind, this.merchant.id));
    // the person waits on the pavement between the kerb and the door, facing the street
    const who = this.marker.getObjectByName('person');
    if (who) {
      if (who.userData.facesPlusZ) {
        who.rotation.y = Math.atan2(f.front.x, -f.front.y);
        who.position.set(-f.front.x * 2.2, 0, f.front.y * 2.2);
      } else who.rotation.y = Math.atan2(-f.front.x, f.front.y);
    }
    this.group.add(this.marker);
  }

  update(t: number) {
    if (this.pin) this.pin.position.y += Math.sin(t * 1.6) * 0.006;
    const s = 1 + Math.sin(t * 2.4) * 0.03;
    this.pickupRing.scale.set(s, s, s);
  }

  dispose() {
    this.disposed = true;
    disposeOwned(this.group);
  }

}

/** Who hands over or receives the order at a business. */
export function roleFor(m: Merchant | null, kind: 'pickup' | 'dropoff', seed = 0): PersonId {
  if (kind === 'dropoff' || !m) return (['woman_casual', 'jacket_man', 'cap_man'] as const)[Math.abs(seed) % 3]!;
  if (m.building_type === 'factory' || m.building_type === 'warehouse') return 'worker';
  if (m.building_type === 'office') return 'jacket_man';
  const name = `${m.name_en} ${m.name_ar}`.toLowerCase();
  if (name.includes('pizza') || name.includes('بيتزا')) return 'pizza_carrier';
  if (m.building_type === 'restaurant' || m.category?.slug === 'restaurants') return 'staff';
  return 'woman_casual';
}

/** Floating exclamation mark over the person waiting with an order. */
function exclamation() {
  const mat = new THREE.MeshBasicMaterial({ color: '#f5c400' });
  const g = new THREE.Group();
  g.name = 'bang';
  const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.26, 4, 10), mat);
  bar.position.y = 0.26;
  bar.scale.set(1.15, 1, 0.75);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), mat);
  dot.position.y = 0;
  g.add(bar, dot);
  g.position.y = 2.2;
  return g;
}

/** Mission marker: soft light column, kerb ring and a person with the order. */
export function targetBeacon(kind: 'pickup' | 'dropoff', at: LocalPoint, shirt = '#3a3d41', who?: PersonId) {
  const color = '#e38b1d';
  const grp = new THREE.Group();
  grp.position.copy(v3(at));
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 60, 24, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  column.position.y = 30;
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.3, 3.7, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.2;
  ring.name = 'pulse';
  const fill = new THREE.Mesh(new THREE.CircleGeometry(3.3, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.19;
  const model = who ? person(who) : null;
  const p = model ?? pedestrian(kind === 'pickup' ? shirt : '#4b5563', kind === 'pickup');
  p.name = 'person';
  // generated people face +z, the procedural fallback faces -z
  p.userData.facesPlusZ = Boolean(model);
  p.position.set(2.4, 0, 0);
  if (model && kind === 'pickup') p.add(exclamation());
  grp.add(column, ring, fill, p);
  return grp;
}
