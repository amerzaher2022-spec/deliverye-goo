// A merchant's presence in the 3D world, built entirely from its saved record:
// position, entrance (which way the building faces), pickup point, building
// type, sign size/position, brand colour, logo and sponsorship benefits.
// Rebuilt whenever the record changes, so dashboard edits show up live.

import * as THREE from 'three';
import { toLocal, type LocalPoint } from '../../../shared/geo';
import { nearestOnNetwork, type RoadGraph } from '../../../shared/roads';
import type { BuildingType, DistrictData, Merchant } from '../../../shared/types';
import type { Box } from './collision';
import { v3 } from './world';
import { facadeTexture, hazardTexture, loadImage, shade, signTexture, stripeTexture } from './textures';

export const BUILDING_SIZE: Record<BuildingType, { w: number; d: number; h: number }> = {
  restaurant: { w: 16, d: 14, h: 8 },
  shop: { w: 18, d: 14, h: 7 },
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

function lambert(color: string | number, extra: THREE.MeshLambertMaterialParameters = {}) {
  return new THREE.MeshLambertMaterial({ color, ...extra });
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class MerchantView {
  readonly group = new THREE.Group();
  readonly frame: MerchantFrame;
  private marker: THREE.Object3D | null = null;
  private spin: THREE.Object3D | null = null;
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

    // pickup pad on the kerb
    const ringMat = new THREE.MeshBasicMaterial({ color: merchant.brand_color, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    this.pickupRing = new THREE.Mesh(new THREE.RingGeometry(2.2, 3, 32), ringMat);
    this.pickupRing.rotation.x = -Math.PI / 2;
    this.pickupRing.position.copy(v3(f.pickup, 0.16));
    this.group.add(this.pickupRing);

    const benefits = merchant.sponsorship?.benefits;
    if (benefits?.highlightMarker) {
      const size = BUILDING_SIZE[merchant.building_type];
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.6),
        new THREE.MeshBasicMaterial({ color: '#ffd23f' }),
      );
      gem.position.copy(v3(f.centre, size.h + 6));
      this.spin = gem;
      this.group.add(gem);
    }
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
    const wall = lambert(t === 'office' ? '#dde6ee' : t === 'factory' || t === 'warehouse' ? '#d9d4c8' : '#efe3cf');
    if (t === 'office') {
      const tex = facadeTexture('glass');
      tex.repeat.set(w / 6, h / 4);
      const facade = new THREE.MeshLambertMaterial({ map: tex });
      g.add(box(w, h, d, facade, 0, h / 2, 0));
      g.add(box(w + 0.6, 0.8, d + 0.6, lambert('#7d8a96'), 0, h + 0.4, 0));
      // lobby canopy
      g.add(box(10, 0.4, 4, lambert('#2f3b47'), 0, 4.2, d / 2 + 2));
      g.add(box(8, 3.6, 0.2, lambert('#1d2d3d', { emissive: '#203040' }), 0, 1.8, d / 2 + 0.11));
      for (const x of [-5.5, 5.5]) g.add(this.flag(x, d / 2 + 6));
    } else if (t === 'factory') {
      g.add(box(w, h, d, wall, 0, h / 2, 0));
      // saw-tooth roof
      const tooth = new THREE.CylinderGeometry(0.01, 3.4, w, 3, 1);
      tooth.rotateZ(Math.PI / 2);
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(tooth, lambert('#9aa5ad'));
        m.position.set(0, h + 1.6, -d / 2 + 4 + i * (d - 8) / 4);
        m.castShadow = true;
        g.add(m);
      }
      const chimney = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 26, 12), new THREE.MeshLambertMaterial({ map: stripeTexture('#c0392b', '#ecf0f1') }));
      chimney.position.set(w / 2 - 6, 13, -d / 2 + 6);
      chimney.castShadow = true;
      g.add(chimney);
      // office annex and gate
      g.add(box(14, 6, 8, lambert('#eee6d6'), -w / 2 + 9, 3, d / 2 + 4));
      g.add(box(1.2, 3, 1.2, lambert('#7f8c8d'), 8, 1.5, d / 2 + 14));
      g.add(box(1.2, 3, 1.2, lambert('#7f8c8d'), 18, 1.5, d / 2 + 14));
      // big doors
      g.add(box(10, 7, 0.3, new THREE.MeshLambertMaterial({ map: stripeTexture('#8e9aa3', '#7b8790') }), 10, 3.5, d / 2 + 0.16));
    } else if (t === 'warehouse') {
      g.add(box(w, h, d, wall, 0, h / 2, 0));
      g.add(box(w + 1, 0.8, d + 1, lambert(shade(this.brand(), -0.2)), 0, h + 0.4, 0));
      const doorTex = stripeTexture('#a7b0b7', '#98a1a8');
      doorTex.repeat.set(1, 6);
      const doorMat = new THREE.MeshLambertMaterial({ map: doorTex });
      const frameMat = new THREE.MeshLambertMaterial({ map: hazardTexture() });
      for (const x of [-14, 0, 14]) {
        g.add(box(9.4, 6.4, 0.3, frameMat, x, 3.2, d / 2 + 0.1));
        g.add(box(8, 5.6, 0.4, doorMat, x, 2.8, d / 2 + 0.2));
      }
      g.add(box(w - 4, 1.2, 4, lambert('#a0a4a8'), 0, 0.6, d / 2 + 2));
    } else {
      // restaurant / shop: two storeys, glass storefront
      g.add(box(w, h, d, wall, 0, h / 2, 0));
      g.add(box(w + 0.4, 0.5, d + 0.4, lambert(shade(this.brand(), -0.25)), 0, h + 0.25, 0));
      const glass = new THREE.MeshLambertMaterial({ color: '#2b3a45', emissive: '#6b4a1f', emissiveIntensity: 0.55 });
      g.add(box(w - 2, 3.2, 0.2, glass, 0, 1.7, d / 2 + 0.05));
      g.add(box(2.2, 2.8, 0.25, lambert('#3b2a1e'), w / 2 - 3, 1.4, d / 2 + 0.12));
      // upper windows
      const win = lambert('#5d7891');
      for (const x of [-w / 2 + 3, -w / 4 + 1, w / 4 - 1, w / 2 - 3]) g.add(box(2.2, 1.6, 0.15, win, x, 6.2, d / 2 + 0.05));
      if (t === 'restaurant' || this.merchant.sponsorship?.benefits.enhancedSignage) {
        const tex = stripeTexture(this.brand(), '#fdfdfd');
        tex.repeat.set((w - 1) / 3, 1);
        const awning = new THREE.Mesh(new THREE.BoxGeometry(w - 1, 0.15, 2.6), new THREE.MeshLambertMaterial({ map: tex }));
        awning.position.set(0, 3.6, d / 2 + 1.25);
        awning.rotation.x = 0.32;
        awning.castShadow = true;
        g.add(awning);
      }
      if (t === 'restaurant' && this.quality !== 'low') {
        const table = new THREE.CylinderGeometry(0.6, 0.6, 0.1, 10);
        const leg = new THREE.CylinderGeometry(0.06, 0.06, 0.8, 5);
        for (const x of [-4, 0, 4]) {
          const top = new THREE.Mesh(table, lambert('#f4f1ea'));
          top.position.set(x, 0.85, d / 2 + 4.2);
          const l = new THREE.Mesh(leg, lambert('#555'));
          l.position.set(x, 0.4, d / 2 + 4.2);
          g.add(top, l);
        }
      }
      if (this.merchant.sponsorship?.benefits.enhancedSignage) for (const x of [-w / 2 - 0.5, w / 2 + 0.5]) g.add(this.flag(x, d / 2 + 3));
    }
    this.addSign(g, w, d, h);
  }

  private flag(x: number, z: number) {
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 7, 6), lambert('#c9ced3'));
    pole.position.set(0, 3.5, 0);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.6), new THREE.MeshLambertMaterial({ color: this.brand(), side: THREE.DoubleSide }));
    cloth.position.set(0.72, 5.4, 0);
    grp.add(pole, cloth);
    grp.position.set(x, 0, z);
    return grp;
  }

  private signPlane(width: number) {
    const geo = new THREE.PlaneGeometry(width, width / 4);
    const mat = new THREE.MeshBasicMaterial({ color: this.brand(), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    // paint asynchronously once the logo is loaded
    void loadImage(this.merchant.logo_url).then((logo) => {
      if (this.disposed) return;
      const { texture } = signTexture({
        nameAr: this.merchant.name_ar,
        nameEn: this.merchant.name_en,
        color: this.brand(),
        logo,
        sponsored: !!this.merchant.sponsorship,
      });
      mat.map = texture;
      mat.color.set('#ffffff');
      mat.needsUpdate = true;
    });
    return mesh;
  }

  private addSign(g: THREE.Group, w: number, d: number, h: number) {
    const scale = SIGN_SCALE[this.merchant.sign_size] * (this.merchant.sponsorship?.benefits.signScale ?? 1);
    const pos = this.merchant.sign_position;
    if (pos === 'front' && h <= 14) {
      const width = Math.min(w - 1, 10 * scale);
      const sign = this.signPlane(width);
      sign.position.set(0, Math.min(h - width / 8 - 0.4, 4.6 + width / 8), d / 2 + 0.3);
      g.add(sign);
      if (this.merchant.sponsorship?.benefits.enhancedSignage) {
        const glow = box(width + 0.5, width / 4 + 0.5, 0.15, new THREE.MeshBasicMaterial({ color: '#ffd23f' }), 0, sign.position.y, d / 2 + 0.2);
        glow.castShadow = false;
        g.add(glow);
      }
    } else if (pos === 'pylon') {
      const width = 7 * scale;
      const sign = this.signPlane(width);
      const poleH = 6 + width / 4;
      const pole = box(0.5, poleH, 0.5, lambert('#5f6b75'), w / 2 + 2, poleH / 2, d / 2 + 6);
      sign.position.set(w / 2 + 2, poleH + width / 8, d / 2 + 6);
      g.add(pole, sign);
    } else {
      // roof (also used for tall buildings with a "front" sign)
      const width = Math.min(Math.max(w - 2, 8), (t(this.merchant.building_type) ? 22 : 12) * scale);
      const sign = this.signPlane(width);
      sign.position.set(0, h + width / 8 + 0.8, d / 2 - 1);
      const frame = box(width + 0.4, 0.3, 0.3, lambert('#4a5560'), 0, h + 0.65, d / 2 - 1);
      g.add(sign, frame);
    }
    function t(type: BuildingType) {
      return type === 'factory' || type === 'warehouse' || type === 'office';
    }
  }

  private addLoadingZone(branded: boolean) {
    const p = this.frame.pickup;
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), new THREE.MeshLambertMaterial({ map: hazardTexture(), transparent: true, opacity: 0.85 }));
    zone.rotation.x = -Math.PI / 2;
    zone.rotation.z = Math.atan2(this.frame.front.y, this.frame.front.x);
    zone.position.copy(v3(p, 0.14));
    this.group.add(zone);
    if (branded) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, color: '#ffffff' });
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), mat);
      decal.rotation.x = -Math.PI / 2;
      decal.position.copy(v3(p, 0.18));
      void loadImage(this.merchant.logo_url).then((img) => {
        if (!img || this.disposed) return;
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        mat.map = tex;
        mat.needsUpdate = true;
      });
      this.group.add(decal);
    }
  }

  private addBillboard() {
    const f = this.frame;
    // beside the pickup, set back from the kerb
    const side = { x: -f.front.y, y: f.front.x };
    const at = { x: f.pickup.x + side.x * 12 - f.front.x * 2, y: f.pickup.y + side.y * 12 - f.front.y * 2 };
    const grp = new THREE.Group();
    grp.position.copy(v3(at));
    grp.rotation.y = Math.atan2(f.front.x, -f.front.y);
    grp.add(box(0.5, 7, 0.5, lambert('#4a5560'), -3, 3.5, 0), box(0.5, 7, 0.5, lambert('#4a5560'), 3, 3.5, 0));
    const sign = this.signPlane(10);
    sign.position.set(0, 8, 0);
    grp.add(sign);
    this.group.add(grp);
  }

  /** Mission marker over this merchant's pickup/drop-off point. */
  setTarget(kind: 'pickup' | 'dropoff' | null) {
    if (this.marker) {
      this.group.remove(this.marker);
      this.marker = null;
    }
    if (!kind) return;
    this.marker = targetBeacon(kind === 'pickup' ? '#2ec4ff' : '#3ddc84', kind === 'pickup' ? this.frame.pickup : this.frame.dropoff);
    this.group.add(this.marker);
  }

  update(t: number) {
    if (this.spin) {
      this.spin.rotation.y = t * 1.5;
      this.spin.position.y += Math.sin(t * 2) * 0.01;
    }
    const s = 1 + Math.sin(t * 3) * 0.06;
    this.pickupRing.scale.set(s, s, s);
  }

  dispose() {
    this.disposed = true;
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) {
        const mm = m as THREE.MeshBasicMaterial;
        mm.map?.dispose();
        m.dispose();
      }
    });
  }
}

/** Tall translucent light column + pulsing ground ring + a waiting person with a parcel. */
export function targetBeacon(color: string, at: LocalPoint) {
  const grp = new THREE.Group();
  grp.position.copy(v3(at));
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.4, 70, 24, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  column.position.y = 35;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.2, 4, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.2;
  ring.name = 'pulse';
  grp.add(column, ring, person(color));
  const bang = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.4, 4), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
  bang.rotation.x = Math.PI;
  bang.position.set(2.5, 3.3, 0);
  bang.name = 'bob';
  grp.add(bang);
  return grp;
}

export function person(shirt: string) {
  const grp = new THREE.Group();
  const skin = lambert('#c99a74');
  const legs = box(0.5, 0.9, 0.3, lambert('#2c3e50'), 0, 0.45, 0);
  const torso = box(0.6, 0.75, 0.35, lambert(shirt), 0, 1.28, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skin);
  head.position.y = 1.85;
  const parcel = box(0.55, 0.4, 0.45, lambert('#c8a165'), 0, 1.2, 0.4);
  grp.add(legs, torso, head, parcel);
  grp.position.set(2.5, 0, 0);
  return grp;
}
