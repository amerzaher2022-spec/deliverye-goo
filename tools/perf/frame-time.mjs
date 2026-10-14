// Frame-time measurement at a fixed place and camera (the game's start on Kurdistan Street before the
// Iskan tunnel), used to compare versions. Run against a server started with the production build:
//
//   PORT=3100 [LEAN=1] [CHROMIUM_PATH=...] node tools/perf/frame-time.mjs <label> <low|medium|high> <rider|chase|far> <hour> <clear|cloudy|rain|storm|fog>
//
// It stops the game loop and times each part of a frame (logic, mirrors, main view with post-processing)
// waiting for the GPU with a 1-pixel readPixels (gl.finish does not wait in Chromium), median of several
// frames. Without LEAN it also repeats the main view with one thing removed at a time (mirrors, shadows,
// post-processing, the city, traffic, the whole world, the sky), at half resolution, and with plain
// facades, to show where the time goes. Prints one JSON line.
import { chromium } from '@playwright/test';
const [label, quality = 'medium', camera = 'rider', hour = '13', weather = 'clear'] = process.argv.slice(2);
const b = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300)));
await p.addInitScript((q) => {
  localStorage.setItem('dg.settings', JSON.stringify({ quality: q, autoQuality: false, controls: 'buttons', camera: 'chase' }));
  localStorage.setItem('dg.lang', 'en');
}, quality);
const t0 = Date.now();
await p.goto('http://localhost:' + (process.env.PORT ?? '3100') + '/?debug=1');
await p.getByTestId('main-menu').waitFor({ timeout: 240000 });
const loadMs = Date.now() - t0;
await p.waitForFunction(() => window.__dg);
await p.getByTestId('start').click();
await p.waitForTimeout(1500);
const res = await p.evaluate(async ([cam, h, w, lean]) => {
  const e = window.__dg.engine;
  cancelAnimationFrame(e.raf);
  e.loop = () => {};
  e.atmos.set({ hour: Number(h), autoTime: false, weather: w, autoWeather: false });
  e.atmos.settle();
  e.setCameraMode(cam);
  // the same spot every run: the start point, standing still
  const v = e.vehicle;
  const ctx = e.renderer.getContext();
  const px = new Uint8Array(4);
  // readPixels cannot return before the GPU has finished everything queued before it
  const gl = { finish: () => { ctx.bindFramebuffer(ctx.FRAMEBUFFER, null); ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px); } };
  e.renderer.info.autoReset = false;
  const frame = (opts = {}) => {
    const r = {};
    let a = performance.now();
    e.update(1 / 30, (e.elapsed += 1 / 30));
    v.speed = 0;
    gl.finish();
    let b2 = performance.now();
    r.update = b2 - a;
    e.renderer.info.reset();
    a = performance.now();
    if (e.mirrors && e.mirrorsOn && !opts.noMirrors) e.mirrors.render(e.renderer, e.scene, v.frame, e.cameraMode === 'rider', v.object);
    gl.finish();
    b2 = performance.now();
    r.mirrors = b2 - a;
    const mi = { calls: e.renderer.info.render.calls, tris: e.renderer.info.render.triangles };
    e.renderer.info.reset();
    a = performance.now();
    if (opts.noPost) e.renderer.render(e.scene, e.camera);
    else e.post.render();
    gl.finish();
    b2 = performance.now();
    r.main = b2 - a;
    r.calls = e.renderer.info.render.calls;
    r.tris = e.renderer.info.render.triangles;
    r.mirrorCalls = mi.calls;
    r.mirrorTris = mi.tris;
    return r;
  };
  const median = (xs) => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const run = (n, opts) => {
    frame(opts);
    const rs = [];
    for (let i = 0; i < n; i++) rs.push(frame(opts));
    const out = {};
    for (const k of Object.keys(rs[0])) out[k] = Math.round(median(rs.map((r) => r[k])));
    out.total = out.update + out.mirrors + out.main;
    return out;
  };
  const results = {};
  results.full = run(4);
  if (lean) {
    e.loop = () => { e.raf = requestAnimationFrame(e.loop); e.post.render(); };
    e.loop();
    return { results, pixelRatio: e.renderer.getPixelRatio(), size: [e.renderer.domElement.width, e.renderer.domElement.height] };
  }
  results.noMirrors = run(3, { noMirrors: true });
  // without shadows
  const sh = e.renderer.shadowMap.enabled;
  e.renderer.shadowMap.enabled = false;
  e.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
  results.noShadows = run(3, { noMirrors: true });
  e.renderer.shadowMap.enabled = sh;
  e.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
  results.noPost = run(3, { noMirrors: true, noPost: true });
  // which parts of the world cost most: hide one group at a time
  const city = e.world.group.getObjectByName('city');
  if (city) { city.visible = false; results.noCity = run(3, { noMirrors: true }); city.visible = true; }
  const tr = e.traffic?.group; if (tr) { tr.visible = false; results.noTraffic = run(3, { noMirrors: true }); tr.visible = true; }
  e.world.group.visible = false; results.noWorld = run(3, { noMirrors: true }); e.world.group.visible = true;
  results.top = {};
  e.world.group.visible = false;
  results.top.base = run(2, { noMirrors: true }).main;
  for (const c of e.scene.children) {
    if (c === e.world.group || !c.visible || c.isLight) continue;
    c.visible = false;
    results.top[(c.name || c.type) + ':' + c.children.length] = run(2, { noMirrors: true }).main;
    c.visible = true;
  }
  e.world.group.visible = true;
  const skyMesh = e.scene.getObjectByName('sky');
  if (skyMesh) { skyMesh.visible = false; results.noSky = run(3, { noMirrors: true }); skyMesh.visible = true; }
  // fragment-bound test: a quarter of the pixels
  const pr = e.renderer.getPixelRatio();
    e.renderer.setPixelRatio(pr * 0.5); e.post.setSize(e.renderer.domElement.clientWidth, e.renderer.domElement.clientHeight);
  results.halfRes = run(3, { noMirrors: true });
  e.renderer.setPixelRatio(pr); e.post.setSize(e.renderer.domElement.clientWidth, e.renderer.domElement.clientHeight);
  // by material type: swap the facade shader out
  const city2 = e.world.group.getObjectByName('city');
  if (city2) {
    const saved = [];
    city2.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry.attributes.aStyle) { saved.push([o, o.material]); o.material = e.__plain ??= new o.material.constructor({ color: 0xcccccc }); } });
    results.plainFacades = run(3, { noMirrors: true });
    for (const [o, m] of saved) o.material = m;
  }
  e.loop = () => { e.raf = requestAnimationFrame(e.loop); e.post.render(); };
  e.loop();
  return { results, pixelRatio: e.renderer.getPixelRatio(), size: [e.renderer.domElement.width, e.renderer.domElement.height], quality: e.quality };
}, [camera, hour, weather, !!process.env.LEAN]);
console.log(JSON.stringify({ label, quality, camera, hour, weather, loadMs, ...res }));
await p.screenshot({ path: `${process.env.OUT ?? '.'}/perf-${label}-${quality}-${camera}-${hour}-${weather}.png`, timeout: 180000 }).catch((e) => console.log('no screenshot', e.message.slice(0, 80)));
await b.close();
