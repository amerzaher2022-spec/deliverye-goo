# Sawa Erbil · سوا اربيل

A mobile-first 3D delivery-driving game set on Sixty Meter Street in Erbil, with a map-based business dashboard. It is an **investor demonstration**: every business, logo, menu, price and analytics figure in the seed data is fictional. The in-game currency is virtual and cannot be withdrawn, and no payment processing exists anywhere in the product.

لعبة توصيل ثلاثية الأبعاد على شارع الستين في أربيل، مع لوحة إدارة للأنشطة التجارية على الخريطة. هذه **نسخة عرض للمستثمرين**: كل الأنشطة والشعارات والأسعار وأرقام التحليلات الموجودة وهمية، والعملة افتراضية داخل اللعبة فقط، ولا يوجد أي دفع حقيقي.

| | |
|---|---|
| Game | `/` (Arabic by default, English switch in the menu) |
| Dashboard | `/admin` (sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`) |
| Stack | Three.js + React (Vite) · Fastify (Node 22) · PostgreSQL 16 |
| Docs | [Architecture](docs/ARCHITECTURE.md) · [Deployment](docs/DEPLOYMENT.md) · [Investor demo script](docs/DEMO.md) · [Test results](docs/TEST-RESULTS.md) · [Known limitations](docs/LIMITATIONS.md) · [Design system](docs/DESIGN.md) · [3D model credits](docs/CREDITS.md) |

## What it does

- **3D game:** a classic yellow scooter or a city bicycle with a seated rider (helmet, white T-shirt, jeans), or a car; realistic restaurant staff and pedestrians; touch pedals and steering (or a joystick) plus a keyboard; chase, rider and overhead cameras; minimap and full map; route guidance along real road connections; pickup and drop-off zones checked by the server; rewards, levels, vehicle unlocks, achievements, daily challenges and mission history; adaptive graphics quality.
- **Live businesses:** every business is built from its database record (position, entrance direction, building type, sign size and position, brand colour, logo, sponsorship). Changes made in the dashboard appear in a running game within about 6 seconds, with no rebuild.
- **Dashboard:** Leaflet map with search, filters, and draggable building, entrance, pickup and drop-off points. Also a business editor (with uploads, menu, status and a live sign preview), missions, categories, sponsorship packages, sponsorships, analytics (with demo data labelled), an audit log and a guarded demo reset.
- **Security:** scrypt-hashed admin passwords and server-side sessions; anti-CSRF header and Origin checks; login rate limiting; upload checks based on file contents (PNG, JPEG or WebP, 2 MB); images served with a sandbox CSP; rewards guarded by transactions and unique keys so they can never be paid twice.

## Run it locally (or in any cloud workspace)

Requirements: Node 22 and PostgreSQL 16.

```bash
cp .env.example .env            # set DATABASE_URL and the admin email/password
npm install
npm run build
npm start                       # runs migrations, creates the admin, seeds demo data on an empty DB
# http://localhost:3000  ·  http://localhost:3000/admin
```

Development with hot reload: `npm run dev` (API on :3000, Vite on :5173 with an `/api` proxy).

## Tests

```bash
npm run typecheck
npm test                        # API + rules tests against PostgreSQL (TEST_DATABASE_URL)
npm run test:e2e                # browser tests: full investor demo + phone layouts
```

## Map data

The playable district (`shared/data/district.json`) is a **schematic** drawn from Erbil's ring-and-radial street layout. The build environment had no access to OpenStreetMap. `npm run osm:fetch` replaces it with real OpenStreetMap geometry once network access is available; see [Known limitations](docs/LIMITATIONS.md).
