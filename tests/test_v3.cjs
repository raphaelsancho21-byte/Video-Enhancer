// Basic V3 contract checks without browser or added dependencies.
// These run in Node and catch missing editor controls / wiring regressions.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const html=fs.readFileSync('static/v3/index.html','utf8');
const script=fs.readFileSync('static/v3/workspace.js','utf8');
for(const id of [
 'mainFile','overlayFile','audioFile','video','composition','baseTransform',
 'videoTracks','ruler','playhead','zoomRange','magnetBtn','splitBtn','markerBtn',
 'scaleX','scaleY','posX','posY','stretchCanvas','centerCanvas','fillCanvas',
 'undoBtn','redoBtn','overlaySettings','overlayScale','overlayOpacity',
 'audioLane','audioMute','exportBtn','exportDialog','canvasWidth','canvasHeight'
]){
 assert.match(html,new RegExp('id="'+id+'"'),id+' element missing');
}
const all=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
assert.equal(all.length,new Set(all).size,'duplicate HTML IDs');
assert.match(html,/workspace\.js\?v=1/);
for(const entry of ["'/api/editor/export'","'/api/editor/layers/upload'","'/api/editor/import-audio'","'video-enhancer-v3'","function split()","function snapTime(","function moveBase(","function exportProject()"]){
 assert.ok(script.includes(entry),entry+' missing in V3 controller');
}
console.log('V3 STATIC CHECK PASS — controls, services, split, snap, export and project metadata');
