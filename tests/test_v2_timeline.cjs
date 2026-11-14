const test=require('node:test');
const assert=require('node:assert/strict');
const {Timeline,validate}=require('../static/v2/timeline-engine.js');
function setup(){
 const editor=new Timeline({fps:30});
 const media=editor.addMedia({name:'demo.mp4',kind:'video',duration:10,sourceId:'video-file'});
 const v1=editor.addTrack('video','V1');
 const v2=editor.addTrack('video','V2');
 return {editor,media,v1,v2};
}
test('overlap forbidden within one track but accepted on another',()=>{
 const {editor,media,v1,v2}=setup();
 editor.addClip(v1,media,0,{outFrame:90});
 assert.throws(()=>editor.addClip(v1,media,60,{outFrame:90}),/Colisão/);
 editor.addClip(v2,media,60,{outFrame:90});
 assert.equal(editor.track(v2).clips[0].at,60);
 assert.equal(validate(editor.snapshot()),true);
});
test('ripple insert pushes following clips',()=>{
 const {editor,media,v1}=setup();
 editor.addClip(v1,media,0,{outFrame:30});
 const later=editor.addClip(v1,media,30,{outFrame:30});
 editor.addClip(v1,media,30,{outFrame:15,ripple:true});
 assert.equal(editor.clip(later).clip.at,45);
});
test('split preserves source range and timing; undo/redo works',()=>{
 const {editor,media,v1}=setup();
 const id=editor.addClip(v1,media,0,{outFrame:100});
 const right=editor.split(id,45);
 assert.equal(editor.clip(id).clip.length,45);
 assert.equal(editor.clip(right).clip.inFrame,45);
 assert.equal(editor.clip(right).clip.at,45);
 editor.undo();assert.equal(editor.track(v1).clips.length,1);
 editor.redo();assert.equal(editor.track(v1).clips.length,2);
});
test('move enforces collision and destination compatibility',()=>{
 const {editor,media,v1,v2}=setup();
 const a=editor.addClip(v1,media,0,{outFrame:30});
 editor.addClip(v1,media,30,{outFrame:30});
 assert.throws(()=>editor.move(a,v1,20),/Colisão/);
 editor.move(a,v2,20);
 assert.equal(editor.clip(a).track.id,v2);
});
test('trim and ripple keep subsequent clips aligned',()=>{
 const {editor,media,v1}=setup();
 const first=editor.addClip(v1,media,0,{outFrame:30});
 const after=editor.addClip(v1,media,30,{outFrame:30});
 assert.throws(()=>editor.trim(first,0,40),/Colisão/);
 editor.trim(first,0,40,{ripple:true});
 assert.equal(editor.clip(after).clip.at,40);
});
test('project JSON validated; invalid overlapping project refused',()=>{
 const {editor,media,v1}=setup();
 editor.addClip(v1,media,0,{outFrame:30});
 const restored=Timeline.fromJSON(editor.toJSON());
 assert.equal(restored.track(v1).clips.length,1);
 const snapshot=restored.snapshot();
 snapshot.tracks[0].clips.push({...snapshot.tracks[0].clips[0],id:'duplicate',at:10});
 assert.throws(()=>validate(snapshot),/Sobreposição/);
});
