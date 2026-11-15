(()=>{
'use strict';
const $=id=>document.getElementById(id);
const el={video:$('video'),stage:$('composition'),base:$('baseTransform'),viewport:$('monitorViewport'),overlays:$('overlayContainer'),timeline:$('timelineStage'),playhead:$('playhead')};
const state={file:null,url:'',duration:0,sourceWidth:0,sourceHeight:0,width:1920,height:1080,fps:30,
 clips:[],overlays:[],audio:null,audioEl:null,selected:null,cursor:0,playing:false,zoom:76,magnet:true,markers:[],undo:[],redo:[],pending:null,drag:null,gapStamp:null,raf:0,previewScale:1,loading:false,playToken:0};
state.audioEl=document.createElement('audio');state.audioEl.preload='metadata';document.body.appendChild(state.audioEl);
const clamp=(v,a,b)=>Math.min(Math.max(a,v),b),round=(v)=>Math.round(v*state.fps)/state.fps;
const duration=c=>(c.end-c.start)/c.speed;
const endAt=c=>c.at+duration(c);
const total=()=>Math.max(0,...state.clips.map(endAt));
const named=c=>c.kind==='base'?state.file?.name||'Vídeo':c.name||'Sobreposição';
const uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const clone=x=>JSON.parse(JSON.stringify(x));
const asTime=t=>{t=Math.max(0,t||0);const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=Math.floor(t%60);return (h?h+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')};
let noticeTimer=0;
function notice(message){$('statusLine').textContent=message;$('toast').textContent=message;$('toast').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('toast').hidden=true,3800)}
function snapshot(){state.undo.push(JSON.stringify({clips:state.clips,overlays:state.overlays,markers:state.markers,selected:state.selected}));if(state.undo.length>40)state.undo.shift();state.redo=[];updateUndo();}
function updateUndo(){$('undoBtn').disabled=!state.undo.length;$('redoBtn').disabled=!state.redo.length}
function changeHistory(back){const source=back?state.undo:state.redo,target=back?state.redo:state.undo;if(!source.length)return;target.push(JSON.stringify({clips:state.clips,overlays:state.overlays,markers:state.markers,selected:state.selected}));const snap=JSON.parse(source.pop());Object.assign(state,snap);render();seek(Math.min(state.cursor,total()),true);updateUndo();}
const selectedClip=()=>state.clips.find(c=>c.id===state.selected)||state.overlays.find(c=>c.id===state.selected)||null;
function defaultTransform(){return{x:state.width/2,y:state.height/2,width:state.sourceWidth||state.width,height:state.sourceHeight||state.height,rotation:0}}
function clipAt(t=state.cursor){return state.clips.find(c=>t>=c.at-.00001&&t<endAt(c)-.00001)||null}
function sourceTime(c,t=state.cursor){return c.start+(t-c.at)*c.speed}
function syncPlayback(){
 const c=clipAt(),v=el.video;
 if(!state.file)return;
 if(!c){if(!v.paused)v.pause();el.base.hidden=true;syncOverlays();syncAudio();return}
 if(el.base.hidden)el.base.hidden=false;
 const desired=clamp(sourceTime(c),c.start,Math.max(c.start,c.end-.001));
 v.playbackRate=c.speed;
 if(Math.abs(v.currentTime-desired)>.13||!state.playing){try{v.currentTime=desired}catch{}}
 applyTransform(c.transform||defaultTransform());
 syncOverlays();syncAudio();
}
function seek(t,force=false){state.cursor=clamp(t,0,total());syncPlayback();updatePlayhead();if(force)el.video.pause();}
function updatePlayhead(){el.playhead.style.left=(94+state.cursor*state.zoom)+'px';$('timeLabel').textContent=asTime(state.cursor)+' / '+asTime(total());$('durationLabel').textContent=asTime(total());}
function stop(){state.playing=false;el.video.pause();state.audioEl.pause();state.gapStamp=null;state.playToken++;$('playBtn').textContent='▶';for(const v of el.overlays.querySelectorAll('video'))v.pause();cancelAnimationFrame(state.raf);state.raf=0;}
function begin(){if(!state.file||!state.clips.length)return;state.playing=true;state.playToken++;$('playBtn').textContent='Ⅱ';state.gapStamp=null;syncPlayback();tick();const c=clipAt();if(c)el.video.play().catch(()=>stop());}
function toggle(){state.playing?stop():begin()}
function tick(now){
 if(!state.playing)return;
 const c=clipAt();
 if(c&&(!el.video.paused||state.gapStamp===null)){
  const elapsed=(el.video.currentTime-c.start)/c.speed;
  state.cursor=clamp(c.at+Math.max(0,elapsed),c.at,endAt(c));
  if(el.video.currentTime>=c.end-.025||state.cursor>=endAt(c)-.005){
   state.cursor=endAt(c);el.video.pause();state.gapStamp=now||performance.now();
   const next=state.clips.filter(x=>x.at>=state.cursor-.005).sort((a,b)=>a.at-b.at)[0];
   if(next&&Math.abs(next.at-state.cursor)<.03){seek(next.at);state.gapStamp=null;el.video.play().catch(()=>stop())}
  }
 }else{
  if(state.gapStamp===null)state.gapStamp=now||performance.now();
  const n=now||performance.now(),dt=Math.max(0,(n-state.gapStamp)/1000);
  state.gapStamp=n;
  state.cursor=clamp(state.cursor+dt,0,total());
  const next=clipAt();
  if(next){seek(state.cursor);state.gapStamp=null;el.video.play().catch(()=>stop())}
 }
 updatePlayhead();syncOverlays();syncAudio();
 if(state.cursor>=total()-.008){stop();updatePlayhead();return}
 state.raf=requestAnimationFrame(tick);
}
function syncAudio(){const a=state.audio;if(!a)return;const media=state.audioEl;const t=state.cursor-a.at;const visible=t>=0&&Number.isFinite(media.duration)&&t<media.duration;const wanted=clamp(t,0,Math.max(0,(media.duration||0)-.01));if(visible&&Math.abs(media.currentTime-wanted)>.11)media.currentTime=wanted;
 media.muted=a.muted||$('muteAll').checked;
 if(state.playing&&visible&&!a.muted){if(media.paused)media.play().catch(()=>{})}else if(!media.paused)media.pause();}
function syncOverlays(){
 const t=state.cursor,activeIds=new Set();
 for(const c of state.overlays){
  activeIds.add(c.id);
  let node=el.overlays.querySelector('[data-id="'+c.id+'"]');
  if(!node){
   node=document.createElement('div');node.className='overlay-video';node.dataset.id=c.id;
   const v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='metadata';v.src=c.url;node.appendChild(v);el.overlays.appendChild(node);
   node.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();select(c.id);const box=el.stage.getBoundingClientRect();const x=e.clientX,y=e.clientY,bx=c.x,by=c.y;snapshot();node.setPointerCapture(e.pointerId);
    const move=m=>{c.x=clamp(bx+(m.clientX-x)/Math.max(1,box.width-node.clientWidth),0,1);c.y=clamp(by+(m.clientY-y)/Math.max(1,box.height-node.clientHeight),0,1);positionOverlay(node,c)};
    const done=()=>{node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',done);node.removeEventListener('pointercancel',done);render()};
    node.addEventListener('pointermove',move);node.addEventListener('pointerup',done);node.addEventListener('pointercancel',done);
   });
  }
  const visible=!c.hidden&&t>=c.at&&t<c.at+(c.end-c.start);
  node.hidden=!visible;positionOverlay(node,c);
  const v=node.querySelector('video');
  if(!visible){if(!v.paused)v.pause();continue}
  const wanted=c.start+(t-c.at);
  if(Math.abs(v.currentTime-wanted)>.17&&Number.isFinite(v.duration)){try{v.currentTime=wanted}catch{}}
  if(state.playing&&v.paused)v.play().catch(()=>{});
  else if(!state.playing&&!v.paused)v.pause();
 }
 for(const child of [...el.overlays.children])if(!activeIds.has(child.dataset.id)){child.querySelector('video')?.pause();child.remove()}
}
function positionOverlay(node,c){const ratio=c.height/c.width,scale=c.scale,topH=el.stage.clientWidth*scale*ratio;node.style.width=(scale*100)+'%';node.style.height=topH+'px';node.style.left=(Math.max(0,el.stage.clientWidth-el.stage.clientWidth*scale)*c.x)+'px';node.style.top=(Math.max(0,el.stage.clientHeight-topH)*c.y)+'px';node.style.opacity=String(c.opacity);node.classList.toggle('active',state.selected===c.id)}
function fitMonitor(){
 const w=state.width,h=state.height;if(!w||!h)return;
 const s=Math.min((el.viewport.clientWidth-32)/w,(el.viewport.clientHeight-32)/h);
 state.previewScale=Math.max(.001,s);el.stage.style.width=(w*state.previewScale)+'px';el.stage.style.height=(h*state.previewScale)+'px';$('resLabel').textContent=w+' × '+h+' · '+state.fps+' fps';$('zoomMonitor').textContent=Math.round(state.previewScale*100)+'%';syncPlayback();
}
function applyTransform(t){if(!state.file)return;
 const k=state.previewScale,node=el.base;node.hidden=!clipAt();
 node.style.width=t.width*k+'px';node.style.height=t.height*k+'px';node.style.left=(t.x-t.width/2)*k+'px';node.style.top=(t.y-t.height/2)*k+'px';node.style.transform='rotate('+t.rotation+'deg)';
}
let guideTimer=0;
function guide(x,y){$('centerGuideX').hidden=!x;$('centerGuideY').hidden=!y;clearTimeout(guideTimer);guideTimer=setTimeout(()=>{$('centerGuideX').hidden=true;$('centerGuideY').hidden=true},600)}
function moveBase(e){
 if(e.button!==0||!state.file)return;
 const c=clipAt();if(!c)return;
 select(c.id);snapshot();e.preventDefault();
 const handle=e.target.closest('[data-handle]')?.dataset.handle||null;
 const t=c.transform||(c.transform=defaultTransform());const initial={...t};
 const sx=e.clientX,sy=e.clientY;el.base.setPointerCapture(e.pointerId);
 const move=m=>{
  const dx=(m.clientX-sx)/state.previewScale,dy=(m.clientY-sy)/state.previewScale;
  if(handle){
   const sideX=handle.includes('e')?1:-1,sideY=handle.includes('s')?1:-1;
   t.width=clamp(initial.width+sideX*dx,10,16000);t.height=clamp(initial.height+sideY*dy,10,16000);
   t.x=initial.x+dx/2;t.y=initial.y+dy/2;
  }else{
   t.x=clamp(initial.x+dx,-state.width,state.width*2);
   t.y=clamp(initial.y+dy,-state.height,state.height*2);
   if(Math.abs(t.x-state.width/2)<8)t.x=state.width/2;
   if(Math.abs(t.y-state.height/2)<8)t.y=state.height/2;
   guide(t.x===state.width/2,t.y===state.height/2);
  }
  applyTransform(t);updateInspector();
 };
 const done=()=>{el.base.removeEventListener('pointermove',move);el.base.removeEventListener('pointerup',done);el.base.removeEventListener('pointercancel',done);render()};
 el.base.addEventListener('pointermove',move);el.base.addEventListener('pointerup',done);el.base.addEventListener('pointercancel',done);
}
el.base.addEventListener('pointerdown',moveBase);
function updateInspector(){
 const c=selectedClip();$('selectionLabel').textContent=c?named(c).slice(0,23):'Nenhuma seleção';
 const isBase=c&&c.kind==='base';const t=isBase?(c.transform||(c.transform=defaultTransform())):null;
 for(const id of ['scaleX','scaleY','posX','posY','rotation','speed','resetTransform','fillCanvas','stretchCanvas','centerCanvas'])$(id).disabled=!isBase;
 if(!t)return;
 const scaleX=Math.round(t.width/Math.max(1,state.sourceWidth)*100),scaleY=Math.round(t.height/Math.max(1,state.sourceHeight)*100);
 $('scaleX').value=String(clamp(scaleX,10,300));$('scaleY').value=String(clamp(scaleY,10,300));
 $('scaleXVal').textContent=scaleX+'%';$('scaleYVal').textContent=scaleY+'%';
 $('posX').value=Math.round(t.x-state.width/2);$('posY').value=Math.round(t.y-state.height/2);
 $('rotation').value=String(clamp(t.rotation,-180,180));$('rotationVal').textContent=Math.round(t.rotation)+'°';$('speed').value=String(c.speed);
}
function select(id){state.selected=id;renderSelection();updateInspector();syncOverlays();}
function renderSelection(){
 for(const node of $('videoTracks').querySelectorAll('.clip'))node.classList.toggle('active',node.dataset.id===state.selected);
 for(const n of el.overlays.children)n.classList.toggle('active',n.dataset.id===state.selected);
}
function applySetting(f){const c=selectedClip();if(!c||c.kind!=='base')return;snapshot();const t=c.transform||(c.transform=defaultTransform());f(t,c);applyTransform(t);render();updateInspector()}
const config=['scaleX','scaleY','rotation','posX','posY'];
for(const id of config)$(id).addEventListener(['posX','posY'].includes(id)?'change':'input',()=>{
 const c=selectedClip();if(!c||c.kind!=='base')return;
 const t=c.transform||(c.transform=defaultTransform());const n=Number($(id).value);if(!Number.isFinite(n))return;
 if(id==='scaleX')t.width=state.sourceWidth*n/100;
 if(id==='scaleY')t.height=state.sourceHeight*n/100;
 if(id==='rotation')t.rotation=n;
 if(id==='posX')t.x=state.width/2+n;
 if(id==='posY')t.y=state.height/2+n;
 applyTransform(t);updateInspector();
});
$('resetTransform').addEventListener('click',()=>applySetting(t=>Object.assign(t,defaultTransform())));
$('stretchCanvas').addEventListener('click',()=>applySetting(t=>Object.assign(t,{width:state.width,height:state.height,x:state.width/2,y:state.height/2,rotation:0})));
$('fillCanvas').addEventListener('click',()=>applySetting(t=>{const s=Math.max(state.width/state.sourceWidth,state.height/state.sourceHeight);Object.assign(t,{width:state.sourceWidth*s,height:state.sourceHeight*s,x:state.width/2,y:state.height/2,rotation:0})}));
$('centerCanvas').addEventListener('click',()=>applySetting(t=>{t.x=state.width/2;t.y=state.height/2}));
$('speed').addEventListener('change',()=>{const c=selectedClip();if(!c||c.kind!=='base')return;snapshot();const next=Number($('speed').value),oldEnd=endAt(c);c.speed=next;const delta=endAt(c)-oldEnd;
 for(const other of state.clips)if(other!==c&&other.at>=oldEnd-.01)other.at=round(Math.max(0,other.at+delta));render()});
function renderAssets(){
 const list=$('assetList');list.replaceChildren();let count=0;
 const add=(name,type,detail,click)=>{count++;const row=document.createElement('div');row.className='asset-tile'+(type==='audio'?' audio':'');const icon=document.createElement('div');icon.className='asset-icon';icon.textContent=type==='audio'?'♫':'▣';const desc=document.createElement('div');desc.className='asset-info';const strong=document.createElement('strong');strong.textContent=name;const small=document.createElement('small');small.textContent=detail;desc.append(strong,small);row.append(icon,desc);row.addEventListener('click',click);list.appendChild(row)};
 if(state.file)add(state.file.name,'video','V1 · Vídeo principal',()=>{if(state.clips[0])select(state.clips[0].id)});
 for(const [i,c] of state.overlays.entries())add(c.name,'video','V'+(i+2)+' · Sobreposição',()=>select(c.id));
 if(state.audio)add(state.audio.name,'audio','A1 · Música MP3',()=>notice('Música pronta na faixa A1.'));
 $('assetCount').textContent=count+' arquivo'+(count===1?'':'s');
 if(!count){const n=document.createElement('div');n.className='empty-media';n.textContent='Importe seu primeiro vídeo para começar.';list.appendChild(n)}
}
function renderRuler(){
 const ruler=$('ruler');ruler.replaceChildren();const width=Math.max(el.timeline.clientWidth-94,total()*state.zoom+150);ruler.style.width=width+'px';
 const secStep=state.zoom>=130?1:state.zoom>=62?2:5;
 for(let t=0;t<=width/state.zoom;t+=secStep){const tick=document.createElement('div');tick.className='ruler-tick';tick.style.left=t*state.zoom+'px';tick.textContent=asTime(t);ruler.appendChild(tick)}
}
function snapTime(t,omit){
 if(!state.magnet)return Math.max(0,round(t));
 const values=[0,state.cursor,...state.markers];
 for(const c of [...state.clips,...state.overlays])if(c.id!==omit)values.push(c.at,endAt(c));
 let near=null;for(const v of values){if(Math.abs(v-t)<12/state.zoom&&(!near||Math.abs(v-t)<Math.abs(near-t)))near=v}
 return Math.max(0,round(near===null?t:near));
}
function primaryRange(c,at){
 const neighbors=state.clips.filter(x=>x.id!==c.id).sort((a,b)=>a.at-b.at);
 const left=neighbors.filter(x=>endAt(x)<=c.at+.001).at(-1);
 const right=neighbors.find(x=>x.at>=endAt(c)-.001);
 return clamp(at,left?endAt(left):0,right?Math.max(left?endAt(left):0,right.at-duration(c)):Math.max(0,total()-duration(c)));
}
function clipNode(c,kind){const item=document.createElement('div');item.className='clip '+(kind==='overlay'?'overlay-clip':'')+(kind==='audio'?' audio-clip':'')+(c.id===state.selected?' active':'');
 item.dataset.id=c.id;item.style.left=c.at*state.zoom+'px';item.style.width=Math.max(8,(kind==='audio'?c.end-c.start:duration(c))*state.zoom)+'px';
 const name=document.createElement('span');name.className='clip-title';name.textContent=named(c);item.appendChild(name);
 const length=document.createElement('span');length.className='clip-dur';length.textContent=asTime(kind==='audio'?c.end-c.start:duration(c));item.appendChild(length);
 if(kind==='base'){for(const side of ['left','right']){const handle=document.createElement('div');handle.className='trim '+side;handle.dataset.trim=side;item.appendChild(handle)}}
 item.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;e.preventDefault();e.stopPropagation();select(c.id);
  const side=e.target.dataset.trim||'move',original=clone(c),neighbor=state.clips.filter(x=>x.id!==c.id).sort((a,b)=>a.at-b.at),sx=e.clientX;
  snapshot();item.setPointerCapture(e.pointerId);let moved=false;
  const move=m=>{
   const dt=round((m.clientX-sx)/state.zoom);if(Math.abs(dt)<.01)return;moved=true;
   if(kind==='audio'){c.at=Math.max(0,snapTime(original.at+dt,c.id))}
   else if(side==='move'){
    const target=snapTime(original.at+dt,c.id);
    c.at=kind==='base'?primaryRange(original,target):clamp(target,0,Math.max(0,total()-(c.end-c.start)));
   }else if(side==='left'){
    const prev=neighbor.filter(x=>endAt(x)<=original.at+.001).at(-1);
    let target=clamp(snapTime(original.at+dt,c.id),prev?endAt(prev):0,original.at+duration(original)-.08);
    const srcDelta=(target-original.at)*original.speed;
    c.start=clamp(original.start+srcDelta,0,original.end-.08);c.at=original.at+(c.start-original.start)/original.speed;
   }else{
    const next=neighbor.find(x=>x.at>=endAt(original)-.001);
    const maxEnd=next?Math.min(original.end+(next.at-endAt(original))*original.speed,state.duration):state.duration;
    c.end=clamp(original.end+dt*original.speed,c.start+.08,maxEnd);
   }
   item.style.left=c.at*state.zoom+'px';item.style.width=Math.max(8,duration(c)*state.zoom)+'px';
   syncPlayback();updatePlayhead();
  };
  const done=()=>{
   item.removeEventListener('pointermove',move);item.removeEventListener('pointerup',done);item.removeEventListener('pointercancel',done);
   if(!moved&&kind!=='audio'){seek(c.at+Math.max(0,(e.clientX-item.getBoundingClientRect().left)/state.zoom),true)}
   render();
  };
  item.addEventListener('pointermove',move);item.addEventListener('pointerup',done);item.addEventListener('pointercancel',done);
 });
 return item;
}
function renderTracks(){
 const root=$('videoTracks');root.replaceChildren();
 const mkTrack=(label,subtitle,clips,kind)=>{
  const row=document.createElement('div');row.className='track';
  const head=document.createElement('div');head.className='track-label';head.textContent=label;
  const sub=document.createElement('small');sub.textContent=subtitle;head.appendChild(sub);
  const lane=document.createElement('div');lane.className='track-lane';
  for(const c of clips)lane.appendChild(clipNode(c,kind));
  row.append(head,lane);root.appendChild(row);
 };
 [...state.overlays].reverse().forEach((c,index)=>mkTrack('▧ V'+(state.overlays.indexOf(c)+2),'Sobreposição',[c],'overlay'));
 mkTrack('▣ V1','Vídeo principal',state.clips,'base');
 const audio=$('audioLane');audio.replaceChildren();if(state.audio&&Number.isFinite(state.audio.end)&&state.audio.end>0){
  audio.appendChild(clipNode({...state.audio,kind:'audio'},'audio'));
 }
 $('audioMute').setAttribute('aria-pressed',String(!!state.audio?.muted));
 $('audioMute').textContent=state.audio?.muted?'🔇':'🔊';
 const width=Math.max(el.timeline.clientWidth,total()*state.zoom+220);
 el.timeline.style.width=width+'px';
}
function renderMarkers(){
 const layer=$('markerLane');layer.replaceChildren();
 for(const marker of state.markers){const item=document.createElement('div');item.className='marker';item.style.left=marker*state.zoom+'px';item.title='Batida '+marker.toFixed(2)+'s · duplo clique para apagar';item.addEventListener('dblclick',()=>{snapshot();state.markers=state.markers.filter(x=>x!==marker);renderMarkers()});layer.appendChild(item)}
}
function render(){renderAssets();renderRuler();renderTracks();renderMarkers();renderSelection();updateInspector();updatePlayhead();syncPlayback();$('exportBtn').disabled=!state.file||!state.clips.length}
async function importPrimary(file){
 if(!file)return;if(file.size>1024*1024*1024){notice('Limite de 1 GB para vídeo');return}
 stop();const url=URL.createObjectURL(file);if(state.url)URL.revokeObjectURL(state.url);
 state.file=file;state.url=url;el.video.src=url;el.video.load();
 try{await new Promise((ok,bad)=>{el.video.onloadedmetadata=ok;el.video.onerror=()=>bad(Error('Codec não reproduzível no navegador'))});
  state.duration=el.video.duration;state.sourceWidth=el.video.videoWidth;state.sourceHeight=el.video.videoHeight;
  if(!Number.isFinite(state.duration)||!state.sourceWidth)throw Error('Mídia inválida');
  state.width=state.sourceWidth;state.height=state.sourceHeight;state.fps=30;
  $('canvasPreset').value='source';$('canvasWidth').value=state.width;$('canvasHeight').value=state.height;$('canvasFps').value=30;
  state.clips=[{id:uid(),kind:'base',start:0,end:state.duration,at:0,speed:1,transform:defaultTransform()}];
  state.overlays=[];state.selected=state.clips[0].id;state.cursor=0;state.markers=[];state.undo=[];state.redo=[];
  if(state.audio)state.audio=null;state.audioEl.pause();state.audioEl.removeAttribute('src');state.audioEl.load();
  $('emptyMonitor').hidden=true;el.base.hidden=false;
  fitMonitor();render();updateUndo();notice('Vídeo importado. Agora a edição acontece na timeline.');
  if(state.pending){const saved=state.pending;state.pending=null;restore(saved)}
 }catch(e){notice(e.message+' — MP4/H.264 costuma funcionar melhor.');state.file=null;state.clips=[];render()}
}
async function importOverlay(file){
 if(!file||!state.file){notice('Importe um vídeo principal antes da sobreposição.');return}
 if(state.overlays.length>=4){notice('Máximo de quatro camadas extras na V3.');return}
 if(file.size>350*1024*1024){notice('Sobreposição acima de 350 MB.');return}
 const form=new FormData();form.append('file',file);notice('Importando sobreposição...');
 try{const r=await fetch('/api/editor/layers/upload',{method:'POST',body:form});const data=await r.json();if(!r.ok)throw Error(data.detail||'Erro ao importar camada');
  snapshot();const len=Math.min(data.duration,Math.max(.08,total()-state.cursor));
  const c={id:data.id,kind:'overlay',name:data.name,url:data.url,width:data.width,height:data.height,at:Math.max(0,state.cursor),start:0,end:len,scale:.4,opacity:1,x:.5,y:.5,hidden:false};
  state.overlays.push(c);state.selected=c.id;render();notice('Camada V'+(state.overlays.length+1)+' adicionada.')
 }catch(e){notice('Falha: '+e.message)}
}
async function importAudio(file){
 if(!file||!state.file){notice('Importe o vídeo principal antes da música.');return}
 if(!/\.mp3$/i.test(file.name)){notice('Selecione um arquivo MP3.');return}
 const form=new FormData();form.append('file',file);
 try{const response=await fetch('/api/editor/import-audio',{method:'POST',body:form});const a=await response.json();if(!response.ok)throw Error(a.detail||'Falha ao importar MP3');
  snapshot();state.audio={...a,at:0,start:0,end:0,muted:false,kind:'audio'};
  state.audioEl.src=a.url;state.audioEl.load();await new Promise((resolve,reject)=>{state.audioEl.onloadedmetadata=resolve;state.audioEl.onerror=()=>reject(Error('Áudio não reproduzível'))});
  state.audio.end=state.audioEl.duration;render();notice('Música adicionada à faixa A1.');}
 catch(e){notice('Falha no MP3: '+e.message)}
}
function split(){const c=clipAt(),t=state.cursor;if(!c||t<=c.at+.08||t>=endAt(c)-.08)return;stop();snapshot();const source=sourceTime(c,t);const a={...clone(c),end:source},b={...clone(c),id:uid(),start:source,at:round(t)};const index=state.clips.indexOf(c);state.clips.splice(index,1,a,b);state.selected=b.id;render();notice('Clipe dividido.')}
function removeSelected(){const c=selectedClip();if(!c)return;stop();snapshot();if(c.kind==='base'){const at=c.at,len=duration(c);state.clips=state.clips.filter(x=>x.id!==c.id);for(const item of state.clips)if(item.at>=at+len-.001)item.at=round(Math.max(at,item.at-len));state.selected=state.clips[0]?.id||null}
 else {state.overlays=state.overlays.filter(x=>x.id!==c.id);state.selected=state.clips[0]?.id||null}
 render();notice('Clipe excluído. Trechos seguintes encaixados.')}
function addMarker(){if(!state.file)return;const t=round(state.cursor);if(state.markers.some(x=>Math.abs(x-t)<.5/state.fps))return;snapshot();state.markers.push(t);state.markers.sort((a,b)=>a-b);renderMarkers();notice('Marcador adicionado em '+t.toFixed(2)+' s')}
function exportForm(){
 const form=new FormData();form.append('file',state.file);
 form.append('clips',JSON.stringify(state.clips.map(c=>({start:c.start,end:c.end,at:c.at,speed:c.speed,transform:c.transform}))));
 form.append('video_overlays',JSON.stringify(state.overlays.map(c=>({id:c.id,at:c.at,start:c.start,end:c.end,x:c.x,y:c.y,scale:c.scale,opacity:c.opacity,hidden:c.hidden}))));
 form.append('composition',JSON.stringify({width:state.width,height:state.height,fps:state.fps}));
 for(const [key,id] of [['quality','quality'],['export_mode','exportMode']])form.append(key,$(id).value);
 form.append('resolution','original');form.append('fps','original');form.append('platform_preset','none');form.append('motion_blur','off');
 form.append('mute',String($('muteAll').checked));
 form.append('mute_source_audio',String($('muteSource').checked));
 if(state.audio&&!state.audio.muted&&!$('muteAll').checked)form.append('extracted_audio',JSON.stringify({id:state.audio.id,at:state.audio.at,volume:1}));
 return form;
}
async function exportProject(){
 if(!state.file||!state.clips.length)return;
 stop();$('exportDialog').hidden=false;$('downloadVideo').hidden=true;$('exportProgress').style.width='0%';$('exportPercentage').textContent='0%';$('closeExport').disabled=true;$('exportBtn').disabled=true;
 try{
  $('exportStatus').textContent='Enviando vídeo ao renderizador local…';
  const response=await fetch('/api/editor/export',{method:'POST',body:exportForm()});
  const job=await response.json();if(!response.ok)throw Error(job.detail||'Não foi possível iniciar exportação');
  while(true){const res=await fetch('/api/jobs/'+job.id);const d=await res.json();if(!res.ok)throw Error(d.detail||'Falha ao consultar exportação');
   $('exportProgress').style.width=(d.progress||0)+'%';$('exportPercentage').textContent=(d.progress||0)+'%';$('exportStatus').textContent=d.stage||'Renderizando…';
   if(d.status==='error')throw Error(d.error||'Falha no FFmpeg');
   if(d.status==='done'){$('downloadVideo').href=d.download;$('downloadVideo').hidden=false;$('exportStatus').textContent='Pronto! O arquivo foi exportado.';break}
   await new Promise(ok=>setTimeout(ok,1000));
  }
 }catch(e){$('exportStatus').textContent='Falha na exportação: '+e.message;notice(e.message)}
 finally{$('closeExport').disabled=false;$('exportBtn').disabled=false}
}
function save(){if(!state.file){notice('Importe um vídeo antes de salvar.');return}
 const data={format:'video-enhancer-v3',version:1,name:$('projectName').value,media:{name:state.file.name,size:state.file.size},clips:state.clips,overlays:state.overlays,audio:state.audio,markers:state.markers,composition:{width:state.width,height:state.height,fps:state.fps},settings:{quality:$('quality').value,mode:$('exportMode').value,muteSource:$('muteSource').checked,muteAll:$('muteAll').checked}};
 const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=($('projectName').value.replace(/[^a-z0-9_-]/gi,'-')||'video-enhancer')+'.ve3.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Projeto salvo em JSON (mídias ficam locais).')
}
function restore(data){
 if(data?.format!=='video-enhancer-v3'||!Array.isArray(data.clips)||!data.clips.length||data.clips.length>120){notice('Projeto V3 inválido.');return}
 if(!state.file){state.pending=data;notice('Importe o vídeo original indicado no projeto para restaurá-lo.');return}
 if(data.media?.name!==state.file.name||data.media?.size!==state.file.size){state.pending=data;notice('Importe o vídeo original: '+(data.media?.name||'desconhecido'));return}
 stop();
 try{
  state.clips=clone(data.clips).filter(c=>c.kind==='base'&&c.start>=0&&c.end>c.start&&c.end<=state.duration+.1&&[.5,1,1.5,2].includes(c.speed)).slice(0,120);
  if(!state.clips.length)throw Error('Nenhum clipe válido');
  state.overlays=Array.isArray(data.overlays)?clone(data.overlays).filter(c=>/^[0-9a-f]{32}$/.test(c.id)&&typeof c.url==='string'&&c.url.startsWith('/api/editor/layers/media/')).slice(0,4):[];
  state.markers=Array.isArray(data.markers)?data.markers.filter(x=>Number.isFinite(x)&&x>=0).slice(0,300):[];
  if(data.composition){state.width=Number(data.composition.width)||state.width;state.height=Number(data.composition.height)||state.height;state.fps=Number(data.composition.fps)||30}
  $('projectName').value=data.name||'Projeto V3';$('canvasWidth').value=state.width;$('canvasHeight').value=state.height;$('canvasFps').value=state.fps;
  state.audio=data.audio?.id?clone(data.audio):null;
  if(state.audio){state.audioEl.src=state.audio.url;state.audioEl.load()}
  if(data.settings){$('quality').value=data.settings.quality||'balanced';$('exportMode').value=data.settings.mode||'fast';$('muteSource').checked=!!data.settings.muteSource;$('muteAll').checked=!!data.settings.muteAll}
  state.selected=state.clips[0].id;state.undo=[];state.redo=[];state.cursor=0;fitMonitor();render();updateUndo();notice('Projeto V3 restaurado.')}
 catch(e){notice('Falha ao restaurar: '+e.message)}
}
function setComposition(){
 const w=Number($('canvasWidth').value),h=Number($('canvasHeight').value);
 if(!(w>=64&&h>=64&&w<=4096&&h<=4096&&w%2===0&&h%2===0)){notice('Use dimensões pares, de 64 a 4096.');return}
 const oldW=state.width,oldH=state.height;state.width=w;state.height=h;state.fps=Number($('canvasFps').value)||30;
 for(const c of state.clips)if(c.transform){c.transform.x=c.transform.x/oldW*w;c.transform.y=c.transform.y/oldH*h}
 fitMonitor();render();
}
$('canvasPreset').addEventListener('change',()=>{const preset=$('canvasPreset').value;if(preset==='source'){$('canvasWidth').value=state.sourceWidth||1920;$('canvasHeight').value=state.sourceHeight||1080}else{const [w,h]=preset.split('x').map(Number);$('canvasWidth').value=w;$('canvasHeight').value=h}setComposition()});
for(const id of ['canvasWidth','canvasHeight','canvasFps'])$(id).addEventListener('change',setComposition);
$('mainFile').addEventListener('change',e=>{const f=e.target.files?.[0];e.target.value='';importPrimary(f)});
$('overlayFile').addEventListener('change',e=>{const f=e.target.files?.[0];e.target.value='';importOverlay(f)});
$('audioFile').addEventListener('change',e=>{const f=e.target.files?.[0];e.target.value='';importAudio(f)});
$('playBtn').addEventListener('click',toggle);$('goStart').addEventListener('click',()=>{stop();seek(0,true)});$('stepForward').addEventListener('click',()=>{stop();seek(state.cursor+1/state.fps,true)});
$('fitMonitor').addEventListener('click',fitMonitor);$('volume').addEventListener('input',()=>{el.video.volume=Number($('volume').value)/100;state.audioEl.volume=Number($('volume').value)/100});el.video.volume=.8;state.audioEl.volume=.8;
$('splitBtn').addEventListener('click',split);$('deleteBtn').addEventListener('click',removeSelected);$('markerBtn').addEventListener('click',addMarker);$('undoBtn').addEventListener('click',()=>changeHistory(true));$('redoBtn').addEventListener('click',()=>changeHistory(false));
$('magnetBtn').addEventListener('click',()=>{state.magnet=!state.magnet;$('magnetBtn').classList.toggle('tool-active',state.magnet);$('magnetBtn').setAttribute('aria-pressed',String(state.magnet))});
$('audioMute').addEventListener('click',()=>{if(!state.audio)return;state.audio.muted=!state.audio.muted;syncAudio();renderTracks()});
$('zoomRange').addEventListener('input',()=>{state.zoom=Number($('zoomRange').value);renderRuler();renderTracks();renderMarkers();updatePlayhead()});
$('ruler').addEventListener('pointerdown',e=>{stop();const bounds=$('ruler').getBoundingClientRect();seek((e.clientX-bounds.left)/state.zoom,true);$('ruler').setPointerCapture(e.pointerId);const move=x=>seek((x.clientX-bounds.left)/state.zoom,true);const done=()=>{$('ruler').removeEventListener('pointermove',move);$('ruler').removeEventListener('pointerup',done);$('ruler').removeEventListener('pointercancel',done)};$('ruler').addEventListener('pointermove',move);$('ruler').addEventListener('pointerup',done);$('ruler').addEventListener('pointercancel',done)});
$('saveProject').addEventListener('click',save);
$('openProject').addEventListener('change',async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;try{restore(JSON.parse(await f.text()))}catch{notice('Projeto JSON inválido')}});
$('exportBtn').addEventListener('click',exportProject);$('closeExport').addEventListener('click',()=>$('exportDialog').hidden=true);
for(const b of document.querySelectorAll('[data-inspector]'))b.addEventListener('click',()=>{document.querySelectorAll('[data-inspector]').forEach(x=>x.classList.toggle('active',x===b));$('clipSettings').hidden=b.dataset.inspector!=='video';$('exportSettings').hidden=b.dataset.inspector!=='export'});
for(const b of document.querySelectorAll('[data-library]'))b.addEventListener('click',()=>{document.querySelectorAll('[data-library]').forEach(x=>x.classList.toggle('active',x===b));(b.dataset.library==='sound'?$('audioFile'):$('mainFile')).focus()});
document.addEventListener('keydown',e=>{
 if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||e.altKey||e.metaKey)return;
 if(e.ctrlKey){if(e.key.toLowerCase()==='z'){e.preventDefault();changeHistory(true)}if(e.key.toLowerCase()==='y'){e.preventDefault();changeHistory(false)}return}
 if(e.code==='Space'){e.preventDefault();toggle()}else if(e.key.toLowerCase()==='s'){e.preventDefault();split()}else if(e.key.toLowerCase()==='m'){e.preventDefault();addMarker()}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeSelected()}else if(e.key==='ArrowRight'){e.preventDefault();stop();seek(state.cursor+1/state.fps,true)}else if(e.key==='ArrowLeft'){e.preventDefault();stop();seek(state.cursor-1/state.fps,true)}
});
window.addEventListener('resize',()=>{fitMonitor();renderRuler();renderTracks();updatePlayhead()});
updateUndo();render();
})();