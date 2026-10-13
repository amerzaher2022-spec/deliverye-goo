# Known limitations and remaining work

Stated plainly, so the demo is never over-sold.

## Not done, and why

| Item | Status | What is needed |
|---|---|---|
| Public deployment | **Not deployed** | Run the Render Blueprint (or any Docker host) with your account, see [DEPLOYMENT.md](DEPLOYMENT.md). The build environment had no hosting credentials, and its network policy blocked hosting APIs. |
| Real OpenStreetMap streets | **Schematic only** | `npm run osm:fetch` (written but **not yet run**: the build environment could not reach Overpass). After fetching, update the road ids used in `server/seed.ts` and check placements on the map. |
| Native Android / iOS builds | **Not produced** | No Android SDK or Xcode was available. The app is an installable PWA; wrap it with Capacitor to make store builds (iOS needs a Mac and Apple signing). |
| Physical device testing | **Outstanding** | Phone layouts were tested with Chromium device emulation (iPhone 13, Pixel 7, Galaxy S9+), not on real phones. |
| Real-GPU performance | **Not measured** | The only renderer available was a software GPU (SwiftShader): low quality ran at about 5–11 fps there; CPU time per frame is about 0.5 ms. Real phones should be far faster, but this needs checking on target devices. Adaptive quality steps down automatically. |
| Map tiles in the build environment | Blocked there | The dashboard map shows the game's road overlay without tiles in that environment. In a normal browser, OSM tiles and Nominatim search load. |

## Design and realism

- The city is **semi-realistic and procedural**: road geometry comes from the district data; buildings, facades, rooftop tanks, parked cars and palms are generated decoration, not copies of real Erbil buildings.
- Vehicles and people are low-poly models built in code with physically based materials. They are not photoreal scanned assets, and there are no traffic or pedestrian AI.
- Interiors are a 2D "inside the shop" panel for interior pickups, not a 3D interior scene.
- Lighting is a fixed afternoon setting; there is no day/night cycle or weather.

## Product scope

- Players are anonymous (browser cookie). There are no player accounts or cross-device progress.
- Only one admin role exists; there are no merchant self-service logins.
- `location_limit` on a package caps concurrent sponsored locations; `featured_limit` caps the featured directory slots. Exclusive geographic ownership is not implemented and is not claimed.
- Analytics history shown on first start is generated demo data (labelled as such). Only events after that are real prototype events.
- Package prices are illustrative. There is no payment, billing, subscription, invoice or renewal anywhere.
