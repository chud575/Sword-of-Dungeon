// FBX -> one glTF binary holding every prop as a named node, sharing one material.
// Runs in headless Chromium because three ships both FBXLoader and GLTFExporter as browser modules.
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = process.cwd(), TH = '/home/user/Neural-Razz-Arena/fargoal/node_modules/three';
const srv = http.createServer((req,res)=>{ const p=decodeURIComponent(req.url.split('?')[0]);
  if(p==='/'){res.setHeader('content-type','text/html');return res.end('<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>');}
  const f=p.startsWith('/three/')?path.join(TH,p.slice(6)):path.join(ROOT,p);
  try{const b=fs.readFileSync(f);res.setHeader('content-type',f.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(b);}catch{res.statusCode=404;res.end();}
}).listen(0);
const port=srv.address().port;
const models=fs.readdirSync('srv/Models').filter(d=>fs.statSync('srv/Models/'+d).isDirectory()&&!['Textures','Materials'].includes(d))
  .flatMap(d=>fs.readdirSync('srv/Models/'+d).filter(f=>f.endsWith('.fbx')).map(f=>({cat:d,name:f.replace('.fbx',''),url:`Models/${d}/${f}`})));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await b.newPage(); page.on('pageerror',e=>console.log('ERR',e.message));
await page.goto(`http://127.0.0.1:${port}/`);
const b64 = await page.evaluate(async ({port,models})=>{
  const THREE=await import('three');
  const {FBXLoader}=await import('three/addons/loaders/FBXLoader.js');
  const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
  const loader=new FBXLoader(); const root=new THREE.Group(); root.name='props';
  // One shared material; the texture is attached at runtime so the glTF carries no image payload.
  const mat=new THREE.MeshStandardMaterial({name:'atlas',roughness:0.85,metalness:0.05,alphaTest:0.5,side:THREE.DoubleSide});
  const report=[];
  for(const m of models){
    let obj; try{obj=await loader.loadAsync(`http://127.0.0.1:${port}/srv/${m.url}`);}catch(e){report.push({...m,error:String(e).slice(0,60)});continue;}
    // Flatten to a single mesh per prop, in metres, feet on y=0, centred on x/z.
    const geos=[]; obj.updateMatrixWorld(true);
    obj.traverse(o=>{ if(o.isMesh&&o.geometry){ const g=o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      for(const k of Object.keys(g.attributes)) if(!['position','normal','uv'].includes(k)) g.deleteAttribute(k);
      if(!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
      geos.push(g.index?g.toNonIndexed():g); } });
    if(!geos.length){report.push({...m,error:'no mesh'});continue;}
    let merged=geos[0];
    if(geos.length>1){ const pos=[],nor=[],uv=[];
      for(const g of geos){ pos.push(...g.attributes.position.array); nor.push(...(g.attributes.normal?g.attributes.normal.array:new Float32Array(g.attributes.position.count*3))); uv.push(...g.attributes.uv.array); }
      merged=new THREE.BufferGeometry();
      merged.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
      merged.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
      merged.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    }
    merged.computeBoundingBox(); const bb=merged.boundingBox;
    const S=0.01; // source units are centimetres; our tile is one world unit
    merged.translate(-(bb.min.x+bb.max.x)/2, -bb.min.y, -(bb.min.z+bb.max.z)/2);
    merged.scale(S,S,S); merged.computeBoundingBox(); merged.computeVertexNormals();
    const mesh=new THREE.Mesh(merged,mat); mesh.name=`${m.cat}/${m.name}`;
    root.add(mesh);
    const s=merged.boundingBox.getSize(new THREE.Vector3());
    report.push({cat:m.cat,name:m.name,tris:merged.attributes.position.count/3,size:[+s.x.toFixed(3),+s.y.toFixed(3),+s.z.toFixed(3)]});
  }
  const glb=await new Promise((res,rej)=>new GLTFExporter().parse(root,res,rej,{binary:true,onlyVisible:false}));
  let bin=''; const u8=new Uint8Array(glb); const CH=0x8000;
  for(let i=0;i<u8.length;i+=CH) bin+=String.fromCharCode.apply(null,u8.subarray(i,i+CH));
  window.__report=report;
  return btoa(bin);
},{port,models});
const report=await page.evaluate(()=>window.__report);
fs.mkdirSync('out',{recursive:true});
fs.writeFileSync('out/props.glb',Buffer.from(b64,'base64'));
fs.writeFileSync('out/props.json',JSON.stringify(report,null,1));
const ok=report.filter(r=>!r.error);
console.log(`converted ${ok.length}/${report.length}  glb=${(fs.statSync('out/props.glb').size/1024).toFixed(0)}KB`);
console.log('failures:',report.filter(r=>r.error).slice(0,5));
console.log('size range (metres):', Math.min(...ok.map(r=>r.size[1])).toFixed(2),'-',Math.max(...ok.map(r=>r.size[1])).toFixed(2),'tall');
await b.close(); srv.close();
