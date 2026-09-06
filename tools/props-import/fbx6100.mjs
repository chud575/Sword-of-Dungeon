// Minimal reader for ASCII FBX 6.1.0 (FBXVersion 6100), the format the 2012-era Dungeon Crawlers
// furniture was exported in. three's FBXLoader only accepts 7.x, so the entourage-set pipeline
// cannot open these files at all; this parser covers the small subset they actually use:
// one or more `Model: "Model::name", "Mesh"` blocks, each with Vertices / PolygonVertexIndex and a
// ByPolygonVertex normal and UV layer. Triangulates by fan and converts Z-up to Y-up.

/** @typedef {{name:string, positions:number[], normals:number[], uvs:number[], tris:number}} Fbx6100Mesh */

/** Lines of a `{ ... }` block, given the index of its opening line. */
function blockLines(lines, openIdx) {
  let depth = 0;
  const out = [];
  for (let i = openIdx; i < lines.length; i++) {
    const l = lines[i];
    depth += (l.match(/\{/g) || []).length;
    depth -= (l.match(/\}/g) || []).length;
    out.push(l);
    if (depth <= 0 && i > openIdx) break;
    if (depth === 0 && i === openIdx) break;
  }
  return out;
}

// A value list may run over many lines; continuations begin with a comma. It ends at the next
// `Key:` / `Key: N {` line or a brace.
function readArray(lines, startIdx, key) {
  const head = lines[startIdx];
  const at = head.indexOf(key + ':');
  if (at < 0) return null;
  let buf = head.slice(at + key.length + 1);
  for (let i = startIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith(',') && !/^[-0-9]/.test(t)) break;
    buf += t;
  }
  const out = [];
  for (const s of buf.split(',')) {
    const v = parseFloat(s);
    if (!Number.isNaN(v)) out.push(v);
  }
  return out;
}

function findArray(lines, key) {
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp('^\\s*' + key + ':\\s*[-0-9]').test(lines[i])) return readArray(lines, i, key);
  }
  return null;
}

/** The first `LayerElement<kind>` sub-block, as its own line array. */
function layerBlock(lines, kind) {
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp('^\\s*LayerElement' + kind + ':\\s*\\d+\\s*\\{').test(lines[i])) return blockLines(lines, i);
  }
  return null;
}

/**
 * @param {string} text contents of an ASCII FBX 6100 file
 * @returns {Fbx6100Mesh[]}
 */
export function parseFbx6100(text) {
  if (!/FBXVersion:\s*6100/.test(text)) throw new Error('not an FBX 6100 file');
  const lines = text.split(/\r?\n/);
  const meshes = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*Model:\s*"Model::([^"]+)",\s*"Mesh"\s*\{/);
    if (!m) continue;
    const block = blockLines(lines, i);
    const verts = findArray(block, 'Vertices');
    const idx = findArray(block, 'PolygonVertexIndex');
    if (!verts || !idx) continue;

    const nBlock = layerBlock(block, 'Normal');
    const normals = nBlock ? findArray(nBlock, 'Normals') : null;
    const uvBlock = layerBlock(block, 'UV');
    const uvSrc = uvBlock ? findArray(uvBlock, 'UV') : null;
    const uvIdx = uvBlock ? findArray(uvBlock, 'UVIndex') : null;

    const positions = [], nor = [], uvs = [];
    let poly = [];      // vertex indices of the polygon being read
    let polyCorner = []; // its position in the flat ByPolygonVertex stream
    let corner = 0, tris = 0;
    const pushCorner = (vi, ci) => {
      // Z-up (3ds Max) -> Y-up: (x, y, z) becomes (x, z, -y).
      positions.push(verts[vi * 3], verts[vi * 3 + 2], -verts[vi * 3 + 1]);
      if (normals) nor.push(normals[ci * 3], normals[ci * 3 + 2], -normals[ci * 3 + 1]);
      if (uvSrc) {
        const u = uvIdx ? uvIdx[ci] : ci;
        uvs.push(uvSrc[u * 2], uvSrc[u * 2 + 1]);
      }
    };
    for (let k = 0; k < idx.length; k++) {
      const raw = idx[k];
      const end = raw < 0;
      poly.push(end ? -raw - 1 : raw);
      polyCorner.push(corner++);
      if (!end) continue;
      for (let f = 1; f + 1 < poly.length; f++) {   // fan triangulation
        pushCorner(poly[0], polyCorner[0]);
        pushCorner(poly[f], polyCorner[f]);
        pushCorner(poly[f + 1], polyCorner[f + 1]);
        tris++;
      }
      poly = []; polyCorner = [];
    }

    // Local transform, if the exporter left one on the node.
    const t = block.find(l => l.includes('"Lcl Translation"'));
    const s = block.find(l => l.includes('"Lcl Scaling"'));
    const nums = (l) => l ? l.split(',').slice(-3).map(Number) : null;
    const T = nums(t), S = nums(s);
    if (S && (S[0] !== 1 || S[1] !== 1 || S[2] !== 1)) {
      for (let k = 0; k < positions.length; k += 3) {
        positions[k] *= S[0]; positions[k + 1] *= S[2]; positions[k + 2] *= S[1];
      }
    }
    if (T && (T[0] || T[1] || T[2])) {
      for (let k = 0; k < positions.length; k += 3) {
        positions[k] += T[0]; positions[k + 1] += T[2]; positions[k + 2] -= T[1];
      }
    }

    meshes.push({ name: m[1], positions, normals: normals ? nor : null, uvs: uvSrc ? uvs : null, tris });
  }
  return meshes;
}
