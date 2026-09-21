# Supplied props — the `?props=supplied` test

Every standing piece, scatter stone and carpet in this mode comes from art the owner supplied: the
**Top-Down Dungeons** and **Top-Down Interiors** packs in their Unity project (`~/My project/Assets`),
imported by `tools/supplied-import/`, alongside the Freeport models already in the game. The walls and
the Dungeon Crawlers floor are untouched — that was the brief.

**The rule the mode enforces:** a decor type either draws a supplied model or draws **nothing**. It
never falls back to the kit pieces or the painted billboards. `render/props/supplied.js` holds the
mapping; `props/furniture.js` and `props/dressing.js` hold the line.

## Trying it

```
?props=supplied                     a normal quest, dressed only in supplied art
?props=supplied&scenario=supplied-props&debug=1   the whole vocabulary in one hall
```

```bash
node tools/shot.mjs --scenario supplied-props --params "props=supplied" --out shots/supplied.png
```

## What stands in for what

Containers are the Dungeons pack's (chests, barrels, boxes, sacks, jars, buckets); furniture is the
Interiors pack's (tables, benches, stools, cupboards, beds, the dressed side table and the wall rack);
fire is the Dungeons pack's furnaces plus the Interiors hearth, candles and chandelier; features are
the wells, columns, rocks, pavement debris and skulls. The packs' own debris replaces the painted
scree, and their carpets the painted rugs.

## What is deliberately empty

`sarcophagus`, `tombSlab`, `anvil`, `cage`, `chainPost`, `retortStand`, `scales`, `mushroomCluster`,
`rat`, `tankards`, `dice`, every remaining floor decal and every wall piece. The packs have no honest
stand-in, so those draw nothing rather than falling back to my art. The packs' cobwebs and ivy ARE
modelled, but as vertical planes a near-plan camera cannot see; they would need re-orienting first.


---

# The import (`tools/supplied-import/`)

Written against `tools/freeport-import/` as its contract, and it reuses that importer's headless page
(`page.mjs`) and glTF writer (`mesh.mjs` `writeGlb`) unchanged. 64 prefabs, named one by one in
`tools/supplied-import/assets.mjs` — nothing is discovered at build time and nothing is substituted.

## Sources

| pack | prefabs here | albedo | AO | normal |
| --- | --- | --- | --- | --- |
| `Top-Down Dungeons` `Prefabs/` + `Prefabs_elementar/` | 37 | `_source/Textures/*.tif` 2048² | `*_ao.png` | `*_nmp.tif` |
| `Top-Down Interiors` `Prefabs/` | 26 | `Origin/Textures/*.tif` 4096² | — | `*_nmp.tif` |
| `BitGem Dungeon_Set_01` | 1 | `Textures/*.tga` 4096² | — | — |

All three live in `~/My project/Assets` (URP-converted). The prefab → FBX → sub-mesh → material →
texture linking is NOT re-derived: it is read from the catalog `jobs.json` that the contact-sheet pass
built (`$SUPPLIED_CATALOG`, a scratchpad path hard-coded at the top of `supplied.mjs`, exactly as the
Freeport importer hard-codes its Dropbox paths). AO and normal maps are resolved by the packs' own
`<name>_ao.png` / `<name>_nmp.tif` convention beside the albedo, and `sips` converts every TIFF/TGA to
PNG at full source resolution, because PIL silently drops a TIFF's fourth sample.

## Settings

**Frame.** The prefab's node hierarchy is rebuilt with Unity's left-handed frame conjugated by the z
flip (position z negated, quaternion x and y negated) and each mesh pre-rotated `rotateY(pi)`, because
Unity's FBX importer negates the X axis. The two together are a rotation, so winding and normals
survive. `transformData`'s scaling pivot is subtracted per sub-mesh — Unity bakes it into the mesh and
FBXLoader does not, and without it a multi-part prefab scatters metres apart.

**Orientation.** `yaw` per asset in `assets.mjs`, read off `preview.mjs --sides` (four elevations)
rather than guessed: the Dungeons chests wear their lock plate on -z, the Interiors beds their pillow
on +z, the BitGem skull faces -z, and the wall pieces (bookcase, peg rack, wall forge, wall torch)
were authored along x. Then centred on the x/z centre of its footprint and stood on y = 0.

**Scale.** `PACK_SCALE`: Dungeons 1.00 (already about a metre to the tile), Interiors 0.70 (that pack
is modelled ~1.4x larger — its crates are 1.18 where the Dungeons box is 0.73), BitGem 1.00. One
factor per pack, not per piece, so a stool stays smaller than a chair stays smaller than a table.
After that any piece whose largest plan dimension still exceeds **1.6 tiles** is scaled down to it;
those are marked `*` in the table below.

**Albedo.** One texture per asset, baked in a headless Chromium as
`AL x _BaseColor x mix(1, AO, 0.85) x clamp(1 + 0.6*(N_map·key - N_mesh·key), 0.62, 1.3)`, key light
(-0.45, 0.8, -0.4) — the same expression `freeport.mjs` bakes. Metallic and smoothness are dropped.
Alpha is taken from the sheet ONLY where Unity's own material is transparent or clipped: `Addons1.tif`
and `Alphas.tif` carry an alpha channel their opaque materials ignore, and copying it made the basin's
body vanish under `alphaTest`. `cutout` is then set from the baked chart itself — true only where more
than 0.5% of a transparent material's own rect really came back under alpha 250 — which is why only
five assets carry alpha although eight materials are named `*_alpha`.

**Where this departs from Freeport, and why.** Freeport ships one texture per prop, so it bakes the
sheet where it stands. These packs ship one atlas per pack — 41 of the 64 share `Addons.tif` — so
baking the sheet per asset would store a 2048² atlas 41 times and give each prop about 15% of its
pixels. Instead each material's UV bounding box (plus two source pixels of gutter) is CROPPED from the
atlas, the crops are shelf-packed into one small power-of-two chart per asset, and TEXCOORD_0 is
remapped into it. The density target is unchanged — **32 texels per tile**, measured from the mesh's
own UV area against its world area — and the GPU picks the mip for the downsample, because the bake
rasterises in chart space so the screen-space derivative of the atlas UV already IS the ratio. Where
a chart has room left the crops are grown into it, since a chart costs the same number of bytes
whether the crops fill it or not: every asset lands at 32 texels per tile or better. A half-size
`_small` copy is written for phones. WebP quality 0.9, and a three-pass colour bleed into the
transparent texels on the cutout assets so filtering cannot fringe them black.

**Parts.** Pieces the runtime will want to light or animate separately keep their parts as separately
named meshes in the glb, as the Freeport chests do: `coals`+`body` (the three furnaces, split on the
prefab's own `Furnace_ring` node), `flame`+`body` (the candles, split on the material Unity clips),
`cloth`+`body` (the beds, split on `Alphas.mat`) and `water`+`body` (the basin). Everything else is
one mesh named after the asset. The prefab's own `Fire*` / `Point light` / `Candleflame` children are
carried through the same yaw and centring and written to `extras.anchors` (and to `data.js`), so a
furnace's fire and a candle's flame do not have to be guessed at.

## Rebuilding

```
node tools/supplied-import/supplied.mjs            # .glb + .webp + supplied.json   (~4 min)
node tools/supplied-import/pack.mjs                # -> data.js
node tools/supplied-import/preview.mjs             # -> preview.png, at the play camera
node tools/supplied-import/preview.mjs --views     # 3/4 + play + front + back, for review
node tools/supplied-import/preview.mjs --sides     # four elevations, for setting `yaw`
```

`--only <regex>` restricts any of them to a few assets; `supplied.mjs --only` merges its rows back
into `supplied.json` instead of truncating it. Scratch output (`out/`, the per-asset baked charts) is
git-ignored. `supplied.json` holds every number the importer measured, including each asset's chart
layout, its raw size in metres before scaling, and how much of it the prefab had buried below its own
floor.

## Files (bytes on disk)

64 assets: **513.6 KB** of glb + **344.3 KB** of WebP = 857.9 KB raw, `data.js` 1164 KB base64.
`*` marks a piece the 1.6-tile cap scaled down.

| asset | source prefab | tiles (w x d, h) | scale | tris | glb | texture | texels/tile | parts |
| --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- |
| `chest2a` | Chest2A [D] | 0.76 x 0.75, 0.79 | 1.000 | 421 | 21.6 KB | 128² 1.6 KB (small 64² 0.9 KB) | 37 | chest2a |
| `chest2b` | Chest2B [D] | 0.76 x 0.69, 0.50 | 1.000 | 385 | 19.3 KB | 128² 1.5 KB (small 64² 0.9 KB) | 41 | chest2b |
| `chest1b` | Chest1B [D] | 0.84 x 0.62, 0.37 | 1.000 | 140 | 10.5 KB | 64² 1.3 KB (small 32² 0.8 KB) | 38 | chest1b |
| `barrel1` | Barrel1 [D] | 0.72 x 0.72, 0.78 | 1.000 | 60 | 3.3 KB | 128² 3.3 KB (small 64² 1.5 KB) | 62 | barrel1 |
| `barrel2` | Barrel2 [D] | 0.72 x 0.72, 0.78 | 1.000 | 60 | 3.3 KB | 128² 4.3 KB (small 64² 1.9 KB) | 55 | barrel2 |
| `barrels1` | Barrels1 [D] | 1.36 x 1.29, 1.54 | 1.000 | 240 | 9.3 KB | 128² 4.4 KB (small 64² 1.9 KB) | 55 | barrels1 |
| `barrels2` | Barrels2 [D] | 1.42 x 1.40, 0.80 | 1.000 | 180 | 7.3 KB | 128² 4.5 KB (small 64² 1.9 KB) | 55 | barrels2 |
| `box1` | Box1 [D] | 0.73 x 0.73, 0.72 | 1.000 | 194 | 12.0 KB | 64² 1.0 KB (small 32² 0.7 KB) | 42 | box1 |
| `box2` | Box2 [D] | 0.91 x 0.91, 0.73 | 1.000 | 108 | 7.2 KB | 32² 0.8 KB (small 16² 0.6 KB) | 42 | box2 |
| `sewers_crate1` | Sewers_crate1 [D] | 1.17 x 1.60, 1.37 | 0.571* | 610 | 35.0 KB | 256² 9.1 KB (small 128² 3.7 KB) | 51 | sewers_crate1 |
| `crate1` | Crate1 [I] | 0.83 x 0.64, 0.51 | 0.700 | 75 | 4.1 KB | 128² 2.4 KB (small 64² 1.3 KB) | 52 | crate1 |
| `crate6` | Crate6 [I] | 0.75 x 0.64, 0.56 | 0.700 | 134 | 8.3 KB | 256² 4.7 KB (small 128² 2.0 KB) | 62 | crate6 |
| `sack1` | Sack1 [D] | 1.00 x 0.64, 0.41 | 1.000 | 42 | 2.6 KB | 64² 1.2 KB (small 32² 0.8 KB) | 40 | sack1 |
| `sack2` | Sack2 [D] | 0.59 x 0.66, 0.74 | 1.000 | 66 | 3.2 KB | 64² 1.2 KB (small 32² 0.8 KB) | 35 | sack2 |
| `sacks_gr1` | Sacks_gr1 [D] | 1.08 x 1.33, 0.65 | 1.000 | 126 | 4.9 KB | 64² 1.2 KB (small 32² 0.8 KB) | 40 | sacks_gr1 |
| `sacks_gr2` | Sacks_gr2 [D] | 1.09 x 1.60, 0.80 | 0.841* | 344 | 10.9 KB | 128² 3.0 KB (small 64² 1.4 KB) | 44 | sacks_gr2 |
| `jar1` | Jar1 [D] | 0.33 x 0.28, 0.49 | 1.000 | 68 | 3.5 KB | 32² 0.7 KB (small 16² 0.6 KB) | 41 | jar1 |
| `jar2` | Jar2 [D] | 0.27 x 0.23, 0.60 | 1.000 | 56 | 3.3 KB | 32² 0.8 KB (small 16² 0.6 KB) | 38 | jar2 |
| `jar3` | Jar3 [D] | 0.38 x 0.33, 0.65 | 1.000 | 44 | 3.1 KB | 32² 0.8 KB (small 16² 0.6 KB) | 33 | jar3 |
| `jar4` | Jar4 [D] | 0.29 x 0.25, 0.48 | 1.000 | 56 | 3.4 KB | 32² 0.8 KB (small 16² 0.6 KB) | 43 | jar4 |
| `jar5` | Jar5 [D] | 0.44 x 0.38, 0.45 | 1.000 | 58 | 3.2 KB | 32² 0.8 KB (small 16² 0.6 KB) | 33 | jar5 |
| `jar6` | Jar6 [D] | 0.35 x 0.31, 0.65 | 1.000 | 81 | 4.1 KB | 32² 0.8 KB (small 16² 0.6 KB) | 38 | jar6 |
| `jar_gr1` | Jar_gr1 [D] | 0.66 x 1.08, 0.65 | 1.000 | 292 | 11.3 KB | 128² 1.8 KB (small 64² 0.9 KB) | 53 | jar_gr1 |
| `jar_gr2` | Jar_gr2 [D] | 0.67 x 1.39, 0.65 | 1.000 | 239 | 9.6 KB | 64² 1.1 KB (small 32² 0.8 KB) | 38 | jar_gr2 |
| `bucket1` | Bucket1 [D] | 0.49 x 0.49, 0.56 | 1.000 | 104 | 5.9 KB | 128² 3.7 KB (small 64² 1.7 KB) | 32 | bucket1 |
| `basin1` | Basin1 [I] | 1.08 x 1.08, 0.69 | 0.700 | 140 | 8.9 KB | 256² 8.1 KB (small 128² 3.5 KB) | 41 | water+body (alpha) |
| `table1` | Table1 [I] | 1.60 x 0.87, 0.63 | 0.626* | 140 | 10.1 KB | 64² 1.0 KB (small 32² 0.7 KB) | 34 | table1 |
| `table1b` | Table1B [I] | 1.60 x 0.48, 0.35 | 0.344* | 176 | 12.4 KB | 64² 1.1 KB (small 32² 0.7 KB) | 54 | table1b |
| `table_tawern3` | Table_Tawern3 [I] | 1.60 x 0.32, 0.30 | 0.256* | 156 | 11.9 KB | 32² 0.6 KB (small 16² 0.6 KB) | 39 | table_tawern3 |
| `bench1` | Bench1 [I] | 1.51 x 0.44, 0.43 | 0.700 | 136 | 9.1 KB | 128² 2.0 KB (small 64² 1.1 KB) | 52 | bench1 |
| `bench3` | Bench3 [I] | 0.49 x 0.46, 0.58 | 0.700 | 156 | 7.1 KB | 128² 2.1 KB (small 64² 1.1 KB) | 60 | bench3 |
| `bench7` | Bench7 [I] | 1.60 x 0.50, 0.36 | 0.552* | 132 | 7.8 KB | 256² 7.3 KB (small 128² 3.1 KB) | 45 | bench7 |
| `cupboard2_1` | Cupboard2_1 [I] | 1.60 x 0.50, 2.20 | 0.601* | 178 | 12.2 KB | 128² 1.7 KB (small 64² 0.9 KB) | 36 | cupboard2_1 |
| `cupboard2_1_books1` | Cupboard2_1_books1 [I] | 1.60 x 0.50, 2.20 | 0.601* | 396 | 27.0 KB | 256² 14.3 KB (small 128² 5.8 KB) | 45 | cupboard2_1_books1 |
| `bed_17` | Bed_17 [I] | 1.09 x 1.60, 0.18 | 0.603* | 52 | 4.1 KB | 64² 0.9 KB (small 32² 0.7 KB) | 51 | cloth+body |
| `bed_18` | Bed_18 [I] | 1.02 x 1.60, 0.19 | 0.603* | 60 | 4.2 KB | 64² 0.8 KB (small 32² 0.7 KB) | 48 | cloth+body |
| `furniture10_1` | Furniture10_1 [I] | 1.27 x 0.30, 0.76 | 0.700 | 272 | 14.8 KB | 256² 9.4 KB (small 128² 3.9 KB) | 41 | furniture10_1 |
| `furniture11` | Furniture11 [I] | 1.07 x 0.14, 0.20 | 0.700 | 112 | 7.1 KB | 64² 0.8 KB (small 32² 0.6 KB) | 37 | furniture11 |
| `chair4` | Chair4 [I] | 0.48 x 0.69, 0.75 | 0.700 | 164 | 10.2 KB | 64² 1.6 KB (small 32² 1.0 KB) | 36 | chair4 |
| `furnace1` | Furnace1 [D] | 0.92 x 0.92, 1.54 | 1.000 | 334 | 19.6 KB | 256² 5.1 KB (small 128² 2.2 KB) | 46 | coals+body |
| `furnace3` | Furnace3 [D] | 0.87 x 0.87, 0.67 | 1.000 | 276 | 18.6 KB | 256² 7.8 KB (small 128² 3.3 KB) | 50 | coals+body |
| `furnace2a` | Furnace2A [D] | 0.86 x 0.74, 1.43 | 1.000 | 241 | 14.1 KB | 256² 12.3 KB (small 128² 4.6 KB) | 38 | coals+body |
| `hearth1` | Hearth1 [I] | 0.74 x 0.74, 1.40 | 0.700 | 228 | 11.8 KB | 256² 13.9 KB (small 128² 5.5 KB) | 33 | hearth1 |
| `candle1` | Candle1 [I] | 0.14 x 0.15, 0.51 | 0.700 | 24 | 3.7 KB | 64² 1.5 KB (small 32² 1.0 KB) | 64 | flame+body (alpha) |
| `candle4` | Candle4 [I] | 0.22 x 0.23, 0.19 | 0.700 | 29 | 3.9 KB | 64² 1.9 KB (small 32² 1.0 KB) | 52 | flame+body (alpha) |
| `chandelier4` | Chandelier4 [I] | 0.25 x 0.25, 0.64 | 0.700 | 202 | 11.9 KB | 64² 1.0 KB (small 32² 0.7 KB) | 32 | chandelier4 |
| `torch1` | Torch1 [D] | 0.20 x 0.48, 1.00 | 1.000 | 160 | 10.0 KB | 64² 1.1 KB (small 32² 0.7 KB) | 50 | torch1 |
| `well1` | Well1 [D] | 1.60 x 1.60, 0.19 | 0.955* | 62 | 3.7 KB | 256² 6.5 KB (small 128² 2.6 KB) | 41 | well1 |
| `well2` | Well2 [D] | 1.60 x 1.60, 0.19 | 0.857* | 80 | 4.0 KB | 256² 5.4 KB (small 128² 2.2 KB) | 51 | well2 |
| `column5` | Column5 [D] | 0.77 x 0.77, 2.00 | 1.000 | 18 | 2.2 KB | 256² 6.2 KB (small 128² 2.5 KB) | 36 | column5 |
| `column7` | Column7 [D] | 0.85 x 0.90, 3.01 | 1.000 | 26 | 2.3 KB | 256² 6.0 KB (small 128² 2.3 KB) | 39 | column7 |
| `column9` | Column9 [D] | 0.60 x 0.60, 1.40 | 1.000 | 28 | 2.6 KB | 256² 10.5 KB (small 128² 4.1 KB) | 63 | column9 |
| `king_obelisk` | King_obelisk [D] | 1.60 x 1.56, 3.37 | 0.801* | 444 | 16.7 KB | 512² 31.5 KB (small 256² 11.2 KB) | 59 | king_obelisk |
| `rock4a` | Rock4A [D] | 1.48 x 1.59, 1.64 | 1.000 | 34 | 2.3 KB | 128² 2.0 KB (small 64² 1.0 KB) | 32 | rock4a |
| `rock4b` | Rock4B [D] | 1.32 x 1.13, 0.38 | 1.000 | 19 | 2.0 KB | 64² 1.0 KB (small 32² 0.7 KB) | 35 | rock4b |
| `pav_debris1` | Pav_debris1 [D] | 0.38 x 0.36, 0.19 | 1.000 | 14 | 1.9 KB | 32² 0.8 KB (small 16² 0.6 KB) | 47 | pav_debris1 |
| `pav_debris4` | Pav_debris4 [D] | 0.65 x 0.70, 0.23 | 1.000 | 18 | 2.1 KB | 64² 1.6 KB (small 32² 0.9 KB) | 55 | pav_debris4 |
| `pav_debris7` | Pav_debris7 [D] | 0.82 x 0.80, 0.30 | 1.000 | 18 | 2.0 KB | 64² 1.4 KB (small 32² 0.8 KB) | 48 | pav_debris7 |
| `pave_debris_gr1` | Pave_debris_gr1 [D] | 1.60 x 1.32, 0.19 | 0.738* | 74 | 4.2 KB | 128² 2.1 KB (small 64² 1.0 KB) | 42 | pave_debris_gr1 |
| `pave_debris_gr2` | Pave_debris_gr2 [D] | 1.27 x 1.60, 0.23 | 0.772* | 82 | 4.6 KB | 128² 2.2 KB (small 64² 1.1 KB) | 37 | pave_debris_gr2 |
| `deco1_skull` | Deco1_skull [D] | 0.20 x 0.35, 0.46 | 1.000 | 58 | 3.0 KB | 32² 0.8 KB (small 16² 0.6 KB) | 56 | deco1_skull |
| `stone_skull` | stone_skull [B] | 0.94 x 0.97, 1.13 | 1.000 | 96 | 5.0 KB | 256² 3.6 KB (small 128² 1.8 KB) | 35 | stone_skull |
| `carpet_round3` | Carpet_round3 [I] | 1.60 x 1.60, 0.00 | 0.439* | 12 | 2.0 KB | 32² 1.2 KB (small 16² 0.8 KB) | 40 | carpet_round3 (alpha) |
| `carpet_square3_1` | Carpet_square3_1 [I] | 1.60 x 1.06, 0.03 | 0.379* | 24 | 2.2 KB | 32² 0.9 KB (small 16² 0.7 KB) | 40 | carpet_square3_1 (alpha) |
