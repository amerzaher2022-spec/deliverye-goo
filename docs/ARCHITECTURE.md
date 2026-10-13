# Architecture

One Node service serves the API, the game and the dashboard. PostgreSQL holds all state, including uploaded images, so the app has no dependency on a separate object store or a writable disk.

```
browser ──HTTPS──> Fastify (server/)
                     ├─ /api/world, /api/merchants, /api/images     public, read-only
                     ├─ /api/player/*                                anonymous player (httpOnly cookie)
                     ├─ /api/admin/*                                 admin session (httpOnly, SameSite=Strict)
                     └─ static web app (dist/web) + SPA fallback
                   PostgreSQL (db/migrations) — merchants, images (bytea), missions,
                     runs, rewards, packages, sponsorships, analytics, audit, sessions
```

## Why this stack

- **Three.js instead of Unity:** Unity and its build tools were not available in the cloud workspace, and a browser build is the only path to "open a URL on any phone" without app store review. Three.js gives real-time 3D, WebGL on every current iPhone and Android browser, and a tiny deploy.
- **One service + PostgreSQL:** the simplest thing that is persistent on a managed host (Render, Railway, Fly, a VPS). Images in the database avoid ephemeral-disk problems on free tiers.
- **Shared TypeScript (`shared/`):** the lat/lng ↔ game-metre transform, road graph, routing and game rules are used by the server, the game and the dashboard alike, so a saved coordinate means the same spot everywhere and the HUD never promises what the server refuses.

## Key modules

| Path | Purpose |
|---|---|
| `shared/geo.ts` | WGS84 local tangent-plane transform (lat/lng ↔ metres around the district origin) |
| `shared/roads.ts` | Road graph from polylines (intersections → nodes), A* routing, nearest-road queries |
| `shared/rules.ts` | Zone radii, transitions, vehicle specs, XP curve, achievements, daily challenges |
| `server/routes/player.ts` | Sessions, missions, collect/deliver with position + speed checks, rewards, challenges |
| `server/routes/admin.ts` | CRUD, uploads (magic-byte validated), sponsorship rules, analytics, audit, demo reset |
| `server/seed.ts` | Fictional dataset; PNG brand assets from `db/seed-assets/` |
| `web/src/game/engine.ts` | Render loop, physics, collisions, camera, zones, route ribbon, adaptive quality |
| `web/src/game/world.ts` | Procedural city from the district data (roads, curbs, zebras, buildings, props, parked cars) |
| `web/src/game/merchants.ts` | A business's 3D presence built from its record; rebuilt when the record changes |
| `web/src/game/assets.ts` | Loads the generated GLB models (scooter, bicycle, riders, people) once; clones share geometry and materials |
| `web/src/game/crowd.ts` | Pedestrians outside businesses, merged into one mesh per material, each with a small collision box |
| `web/src/game/models.ts` | Car, procedural fallbacks for the scooter, bicycle and people; `bakeStatic` merges static parts per material |
| `tools/models/*.py` | Offline model generator (Blender as a Python module): original people (own anatomy and sculpting), vehicles and cars modelled in code, see [CREDITS](CREDITS.md) |
| `web/src/signPainter.ts` | Paints the storefront sign; shared by the game and the dashboard preview |
| `web/src/admin/*` | Dashboard (map manager, editor, missions, packages, sponsorships, analytics) |

## Mission integrity

A run snapshots its pickup and drop-off points at acceptance. Collect and deliver must come from within 14 m and 16 m of those points, in the allowed state order (`accepted → going_to_pickup → collected → going_to_destination → delivered`). The delivery must take at least as long as the fastest vehicle needs for the straight-line distance. The run row is locked `FOR UPDATE`, and `rewards.run_id` is `UNIQUE`, so concurrent or repeated claims pay once.

## Live world updates

Every admin write bumps `app_state.world_version`. Clients poll `/api/world/version` every 6 seconds (and when the tab regains focus) and rebuild only the businesses whose `updated_at` or sponsorship changed. Procedural buildings and parked cars that would overlap a moved business are hidden, along with their collision boxes.

## Rendering budget

Static meshes are merged per material (a storefront costs about 10 draw calls instead of about 60). Buildings, roof props, palms, lamps and parked cars are instanced. Flat ground surfaces use unlit materials below "high" quality. The generated models total about 7 MB (WebP textures). They load in parallel with the world data and are cached by the service worker. A rider is about 12k triangles, a pedestrian 7–9k, a street car 3.2k. Street cars carry their detail (lamps, grille, glass, panel lines, wheels, shading) in one shared 2048 px texture atlas baked from the full models; the atlas alpha marks paint, chrome, glass and matte parts, so each car is one draw call per map cell and still gets its own paint colour. The pavement crowd is 0 / 7 / 14 people at low / medium / high quality and costs about 25 draw calls. If the frame rate stays under 24 fps the game steps down from high to medium to low, unless the player has picked a quality level by hand.
