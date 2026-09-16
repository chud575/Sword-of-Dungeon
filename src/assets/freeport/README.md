# Freeport props

The owner's own Zealot / Freeport models, converted for the game by `tools/freeport-import/`, drawn by
`src/render/props/freeport.js`. They are the default for four kinds of furniture; `?props=kit` shows the
kit pieces they replace.

| decor type | asset | source |
| --- | --- | --- |
| `brazier` (tile hash picks one) | `brazier_a` | `Freeport/Art/Zealot_Assets/Unity Ready/PRP_Brazier_01.unitypackage` → `PRP_Braziers_01.fbx` (bowl + coals) |
| | `brazier_b` | `PRP_Brazier_02.unitypackage` → `PRP_Braziers_02.fbx` (cage, skulls, chains) |
| `cupboard` | `cupboard` | `PRP_Cupboard_01.unitypackage` → `PRP_Cupboard_01.fbx` |
| `table` | `table` | `PRP_Table_01.unitypackage` → `PRP_Table_01.fbx` (table + cloth) |
| `tableLong` (run piece: v0 end, v1 middle, v2 end) | `banquet` `seg0..2` | `PRP_BanquetTableCloth_01.unitypackage` → `PRP_BanquetTableCloth_01.fbx`, stretched to 3 tiles and cut into three one-tile segments |
| `strongbox` (tile hash picks one), treasure-chest pickup (`chest_a`) | `chest_a` | `Freeport/Art/Zealot_Assets/ChestsPrinting1.STL`, components 2 (body) + 3 (lid) |
| | `chest_b` | `ChestsPrinting1.STL`, components 4 (body) + 5 (lid, with a centre strap) |
| `footlocker` | `chest_long` | `Freeport/Art/Zealot_Assets/LongChest_Printing1.STL`, components 1 (body) + 2 (lid) |
| inside the open pickup | `coins` | `ChestsPrinting1.STL`, component 7 (coin heap) |

Variant `>= 1` of `strongbox` / `footlocker` is drawn open (the lid swung back 1.95 rad about its hinge),
as the kit pieces were. A brazier burns at variant 0–1 and is cold at 2+.

## Why the chests are print meshes

There is no textured, game-ready chest in the Freeport set. Two textured chests exist elsewhere and were
looked at and not used: `Dungeon Crawlers/.../Static Objects/Furniture Etc/Treasure_Chest` (FBX 6.1,
2012, 256² cartoon gold texture, heaped gold modelled into the lid — a different style from the Zealot
props) and `Dungeon_Kit/Bonus-Content/Chest/chest_small.fbx` (a third-party asset-pack chest, not the
owner's own art). `Board_01.zip`'s BIG Environment Pack `Props/Barrel_Chest/` holds only `Barrel.fbx` and
`Barrel_Stud.fbx` — no chest. The print plates are the owner's own sculpts in the same hand as the
braziers and cupboard, and they come with separate lids, which is what an open chest needs.

## Settings

`chests.mjs` (pure node): binary STL welded, Z-up → Y-up, split into connected components; each chest
assembled closed (lid centred on the body's rim band), turned so the lock faces +z, scaled so the rim is
0.74 (small) / 0.88 (long) tiles long. Iron vs wood: position rules (body rim, base band and corner posts;
lid lip, end arches and straps) plus the top 7% (3% on the long chest) of each part's relief against a
60-iteration Laplacian-smoothed copy, three majority passes. Decimation: normal-aware vertex clustering
with a quadric representative, 1500 + 1300 triangles (small), 2000 + 1700 (long), 700 (coins).
Hemisphere AO: 40 rays, reach 0.3 tiles, against the closed chest and the floor. Vertices carry their
texel position in a box-projection chart at 32 texels per tile; the runtime maps those onto the prop kit's
atlas (`render/props/kit.js`), so a chest is textured by the kit's own oak / dark / ash / iron / gold cells.

`freeport.mjs` (headless Chromium): FBX via three's `FBXLoader`, node transforms baked; front to +z
(cupboard turned +90°); fit — brazier_a foot 0.70, brazier_b foot 0.68, cupboard height 1.16 with its
back at z −0.30, table length 1.00, banquet depth 0.86 then x stretched to 3.00. Albedo baked at source
resolution (1024²): `AL × mix(1, AO, 0.85) × clamp(1 + 0.6·(N_map·key − N_mesh·key), 0.62, 1.3)`, key
light (−0.45, 0.8, −0.4); gutters keep `AL × AO`. Metallic is dropped. Downsampled by repeated halving to
the power of two that gives at least 32 texels per tile, measured from UV area over world area, minimum
64; a half-size `_phone` copy only where that stays within 1.4× of the grid. WebP quality 0.9.

`pack.mjs` folds every `.glb` and `.webp` here into `data.js` (base64), because the single-file build
permits neither `fetch()` nor `data:` URIs.

## Files (bytes on disk)

See `chests.json` and `freeport.json` for the per-asset numbers the importer measured.

| asset | triangles | glb | texture | footprint (tiles, w × d, h) | texels / tile |
| --- | ---: | ---: | ---: | --- | ---: |
| brazier_a | 552 | 15.3 KB | 64² 2.7 KB | 0.70 × 0.70, 0.41 | 42.9 |
| brazier_b | 6720 | 169.1 KB | 64² 2.5 KB | 0.61 × 0.68, 0.74 | 38.8 |
| cupboard | 2994 | 77.9 KB | 64² 2.2 KB | 0.69 × 0.37, 1.16 | 34.0 |
| table | 1290 | 44.4 KB | 128² 6.7 KB (phone 64² 2.4 KB) | 1.00 × 0.66, 0.34 | 63.1 |
| banquet (3 segments) | 938 | 34.4 KB | 128² 6.0 KB | 3.00 × 0.86, 0.45 | 39.8 |
| chest_a | 2892 | 134.8 KB | kit atlas | 0.80 × 0.56, 0.68 | 32 |
| chest_b | 3172 | 143.1 KB | kit atlas | 0.78 × 0.58, 0.68 | 32 |
| chest_long | 3699 | 162.5 KB | kit atlas | 0.91 × 0.41, 0.42 | 32 |
| coins | 1316 | 52.8 KB | kit atlas | 0.47 × 0.73, 0.18 | 32 |

Total 857 KB raw; `data.js` 1143 KB.

## Rebuilding

```
node tools/freeport-import/chests.mjs     # chest_a, chest_b, chest_long, coins (.glb)
node tools/freeport-import/freeport.mjs   # braziers, cupboard, table, banquet (.glb + .webp)
node tools/freeport-import/pack.mjs       # -> data.js
node tools/freeport-import/preview.mjs    # contact sheet -> tools/freeport-import/out/preview.png
```

The source paths are read-only Dropbox paths hard-coded at the top of each script.
