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
