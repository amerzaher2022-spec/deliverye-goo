# 3D model credits

Every 3D model, texture, logo decal and portrait in this game was made for Sawa Erbil (سوا اربيل, formerly Erbil Delivery World). No third-party models, scans, characters or textures are used, so there is no external licence to clear.

| What | How it was made | Source |
|---|---|---|
| People: courier, restaurant staff, pizza runner, Kurdish man in shal u shapik, young man, woman in a coat and headscarf, factory worker, dispatcher | Own skeleton and anatomy written as signed-distance sculpts, dressed and posed in code. Each one is baked to a game mesh with colour, ambient-occlusion and normal textures. | `tools/models/anatomy.py`, `wardrobe.py`, `cast.py`, `stances.py`, `paint.py`, `bake.py` |
| Classic yellow scooter, black city bicycle | Modelled in code | `tools/models/vehicles.py` |
| Courier hatchback, saloon, SUV, pickup | Lofted bodies with lights, grilles, seams and wheels shaped onto them; the street versions are light meshes with the full model's detail baked into a texture | `tools/models/cars.py`, `parked.py` |
| Sawa Erbil logo (pin with a delivery box over a road), drawn in code (`web/src/brand.ts`, `web/public/icons/`) | Own design | — |
| Uniform badge, backpack print, car door livery, pizza lid print | Rendered from HTML with the IBM Plex Sans Arabic font (SIL Open Font License, already used by the app) | `tools/models/render-decals.mjs` |
| Roads, barriers, pavements | Procedural canvas textures in the game, over photographed materials (below) | `web/src/game/textures.ts` |

The cars and the scooter follow familiar vehicle types: a compact hatchback, a mid-size saloon, a large 4×4, a double-cab pickup and a vintage scooter. They carry no manufacturer names, badges or logos.

## Rebuilding the models

```bash
python3.13 -m venv .venv-models
.venv-models/bin/pip install bpy==5.2.2 numpy scipy scikit-image opencv-python-headless pillow
node tools/models/render-decals.mjs
.venv-models/bin/python tools/models/build_models.py --preview /tmp/previews
```

A full build takes about an hour on four CPU cores, mostly baking the people. Add `--fast` for a quick low-detail pass, or `--only cars` (or `scooter`, `bicycle`, `people`, `dispatcher`) to rebuild one part.

## Map data

Street geometry, tunnels, bridges, building footprints and heights (22,157 buildings, built into `web/public/data/buildings.json` by `scripts/build-buildings.mjs`), trees, parks, business names and landmark positions come from OpenStreetMap: © OpenStreetMap contributors, available under the Open Database License (ODbL), https://www.openstreetmap.org/copyright. The raw extract is in `data/osm/`. The game shows the attribution in its settings, and the dashboard map shows it too. Real business names appear only as street signs and landmarks; none of them is a playable merchant, and none of their logos is used. Before a commercial launch, confirm that businesses shown by name (for example Samad restaurant) are happy to appear.

## Photographed materials and sky

Asphalt, pavers, paving, plaster, sand, a metal shutter and the sky panorama come from Poly Haven (https://polyhaven.com) under CC0 1.0: free for any use, including commercial, with no attribution required. The list is in `web/public/textures/CREDITS.txt`. The originals are on the `asset-candidates` branch (fetched by `.github/workflows/assets-fetch.yml`), and are converted with `tools/assets/convert_polyhaven.py`.


## Sound

Every sound (engine, tyres, brakes, impacts, rain, horns) is synthesised in the browser with the Web Audio API (`web/src/game/audio.ts`). No recorded samples are used.

## Live weather (optional)

When the player turns on "Erbil's current weather" in the settings, the game asks Open-Meteo (https://open-meteo.com, free, no key; weather data CC BY 4.0) for the current conditions in Erbil, every 10 minutes. It is off by default; without a connection the game keeps its own automatic weather.

## Font

IBM Plex Sans Arabic (Arabic and Latin subsets, weights 400–700), © IBM Corp., SIL Open Font License 1.1, shipped in `web/public/fonts` with its licence (`OFL-IBM-Plex-Sans-Arabic.txt`); files taken from the `@fontsource/ibm-plex-sans-arabic` package.
