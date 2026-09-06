# Prop import pipeline

Turns the Dungeon Crawlers "entourage set" Unity asset folder into the two generated modules in
`src/assets/`. Run only when the source assets change — the generated modules are committed, so a
normal build never needs this.

The source folder is NOT in this repo (it is licensed third-party content; see ATTRIBUTION below).
Point the scripts at an extracted copy containing `Models/` and `Prefabs/`.

    node convert.mjs      # 114 FBX -> out/props.glb (one node per prop, metres, feet on y=0)
    node tga2png.mjs 512 out/atlas512.png   # 4096 TGA -> 512 RGBA PNG
    node mkassets.mjs     # -> src/assets/{propsModel,propsAtlas,propsIndex}.js

## Why it is shaped this way

- **Headless Chromium does the conversion.** There is no Blender or assimp in this environment, but
  three.js ships `FBXLoader` and `GLTFExporter` as browser modules, so the browser is the converter.
- **512, not 4096.** At the play camera the source atlas is far finer than our floors and sprites,
  and mixed resolutions on one screen is the failure the art audits kept finding. Downscaled and
  sampled with `NearestFilter`, one texture texel lands near one sprite texel and the props join the
  same pixel grid as the rest of the game.
- **Gzipped base64 JS, not asset files.** The single-file artifact build permits neither `fetch()`
  nor `data:` URIs, so the bytes ship inside the bundle and are inflated at runtime
  (`render/props/models.js`). Gzip takes the glTF from 3137 KB to 691 KB.
- **Raw RGBA for the atlas, not PNG.** A `DataTexture` needs no `Image`, no decode and no `img-src`
  permission, and gzip compresses the raw bytes about as well as PNG does.

## Attribution

The models and texture atlas are third-party content ("entourage_set_01", Dungeon Crawlers /
Drowning Monkeys Games), used with the owner's licence. They are not covered by this project's
licence. The source FBX and the 4096 TGA are deliberately kept out of the repository; only the
downscaled, converted derivatives needed to run the game are committed.

## The second source set: Static Objects / Furniture Etc

The entourage set has no case furniture — no bookcase, cupboard, throne, tomb or rack — which is
exactly the half of AMBIENCE §5.1 that says what a room is FOR. Those come from a different folder
of the same Unity project, and they need a different pipeline for two reasons:

- **They are ASCII FBX 6100** (2011 exporter). three's `FBXLoader` accepts 7.x only and throws
  `FBX version not supported` on sight, so `convert.mjs` cannot open them at all. `fbx6100.mjs`
  reads the subset they use: `Vertices` / `PolygonVertexIndex`, a `ByPolygonVertex` normal layer and
  an `IndexToDirect` UV layer, fan-triangulated, Z-up (3ds Max) converted to Y-up.
- **One texture per piece, not one atlas.** They cannot join the 512 entourage sheet: its UVs are
  already baked into `props.glb` against that exact size and the 4096 source is not in this repo, so
  growing it would renormalise every UV in the library. They get their own packed atlas and their
  own material instead — `models.js` merges both into one mesh table.

```
node furniture.mjs "<.../Static Objects/Furniture Etc>" Bookcase [Cupboard ...]
    -> src/assets/{furnitureModel,furnitureAtlas,furnitureIndex}.js
```

128 texels per piece, for the reason 512 (not 4096) was chosen above: one texture texel near one
sprite texel. One piece costs about 33 KB in the bundle.

## Looking before importing

```
node preview.mjs <dir of name.fbx (+ name.png)> out.png
```

A contact sheet — studio three-quarter, the game's own 17° play camera, and a flat front, with a
1x1 tile pad under each piece — for both FBX formats. Worth running first: the play-camera column
is where a model that looks fine in a three-quarter view turns out to present nothing but its lid.

## Attribution (second set)

"Static Objects" (Dungeon Crawlers / Drowning Monkeys Games), same licence and same rule as above:
the source FBX and PNGs stay out of the repository, only the converted derivatives are committed.
