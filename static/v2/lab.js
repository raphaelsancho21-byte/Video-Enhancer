(() => {
'use strict';
const $=id=>document.getElementById(id);
let editor=new VE2Engine.Timeline({fps:30});
let files=new Map(), selectedMedia=null, selectedClip=null, cursor=0, dragging=null;
const player=$('preview');
const q=(secs)=>VE2Engine.snapFrame(Math.max(0,secs),editor.fps);
const sec=frames=>frames/editor.fps;
const px=()=>Number($('zoom').value);
const total=()=>sec(editor.durationFrames());
function msg(s){$('message').textContent=s}
function timefmt(seconds){return String(Math.floor(seconds/60)).padStart(2,'0')+':'+(seconds%60).toFixed(2).padStart(5,'0')}
function clamp(n,a,b){return Math.min(b,Math.max(a,n))}
function findClipAt(frame) {
 const clips=editor.tracks.flatMap(t=>t.clips.map(c=>({c,t}))).filter(x=>x.c.at<=frame&&frame<x.c.at+x.c.length);
 return clips[0]||null;
}
function preview(clipId=null) {
 let info;
 try{info=editor.clip(clipId||selectedClip)}catch{info=findClipAt(q(cursor))}
 if(!info){player.pause();player.removeAttribute('src');player.load();$('previewStatus').textContent='Sem clipe na posição';return}
 const media=editor.media[info.clip.mediaId],f=files.get(info.clip.mediaId);
 $('previewStatus').textContent='Prévia de '+media.name+' • faixa '+info.track.name;
 if(!f){player.removeAttribute('src');player.load();msg('Reimporte '+media.name+' para recuperar a pré-visualização');return}
 if(player.src!==f.url){player.pause();player.src=f.url;player.load()}
 const at=sec(info.clip.inFrame+clamp(q(cursor)-info.clip.at,0,info.clip.length));
 if(Number.isFinite(at)){try{player.currentTime=at}catch{}}
 player.muted=info.track.kind!=='audio';
}
function seek(seconds){
 cursor=clamp(seconds,0,total());
 $('clock').textContent=timefmt(cursor)+' / '+timefmt(total());
 $('playhead').style.left=(95+cursor*px())+'px';
 preview();
}
function render(){
 const p=px(),length=total(),width=Math.max($('scroll').clientWidth,95+length*p+100);
 $('content').style.width=width+'px';
 $('trackContainer').replaceChildren();
 const ruler=$('ruler');ruler.replaceChildren();
 const step=p>=65?1:p>=35?2:5;
 for(let s=0;s<=length+1;s+=step){const t=document.createElement('span');t.className='tick';t.style.left=(s*p)+'px';t.textContent=timefmt(s).slice(0,5);ruler.append(t)}
 for(const track of editor.tracks){
  const row=document.createElement('div');row.className='track '+(track.kind==='audio'?'audio':'');
  const head=document.createElement('div');head.className='track-head';
  const name=document.createElement('label');name.textContent=track.name;
  const buttons=document.createElement('div');buttons.className='row';
  const lock=document.createElement('button');lock.textContent=track.locked?'🔒':'🔓';lock.title='Bloquear ou desbloquear';
  lock.onclick=()=>{editor.setTrack(track.id,{locked:!track.locked});render()};
  const mute=document.createElement('button');mute.textContent=track.muted?'🔇':'♫';mute.title='Mutar faixa';
  mute.onclick=()=>{editor.setTrack(track.id,{muted:!track.muted});render()};
  buttons.append(lock,mute);head.append(name,buttons);
  const lane=document.createElement('div');lane.className='lane';lane.style.minWidth=(width-95)+'px';
  lane.addEventListener('pointerdown',e=>{if(e.target!==lane)return;selectedClip=null;seek((e.clientX-lane.getBoundingClientRect().left)/p);render()});
  for(const c of track.clips){
   const el=document.createElement('div');el.className='clip'+(selectedClip===c.id?' active':'');
   el.style.left=(sec(c.at)*p)+'px';el.style.width=(sec(c.length)*p)+'px';
   const m=editor.media[c.mediaId];const title=document.createElement('span');title.textContent=m.name;
   const duration=document.createElement('small');duration.textContent=timefmt(sec(c.length));
   el.append(title,duration);
   el.addEventListener('click',e=>{e.stopPropagation();selectedClip=c.id;cursor=sec(c.at);$('moveInput').value=cursor.toFixed(3);seek(cursor);render()});
   el.addEventListener('pointerdown',e=>{
    if(e.button!==0||track.locked)return;
    e.stopPropagation();selectedClip=c.id;dragging={pointer:e.pointerId,element:el,original:c.at,start:e.clientX,trackId:track.id};
    el.setPointerCapture(e.pointerId);e.preventDefault();
   });
   el.addEventListener('pointermove',e=>{
    if(!dragging||dragging.pointer!==e.pointerId||dragging.element!==el)return;
    const next=Math.max(0,dragging.original+Math.round(((e.clientX-dragging.start)/p)*editor.fps));
    el.style.transform='translate3d('+((next-dragging.original)/editor.fps*p)+'px,0,0)';
   });
   function finish(e){
    if(!dragging||dragging.pointer!==e.pointerId||dragging.element!==el)return;
    const gesture=dragging;dragging=null;
    try{const requested=Math.max(0,gesture.original+Math.round(((e.clientX-gesture.start)/p)*editor.fps));
      editor.move(c.id,track.id,requested,{ripple:$('ripple').checked});
      selectedClip=c.id;seek(sec(requested));msg('Clipe movido');
    }catch(err){msg(err.message)}render();
   }
   el.addEventListener('pointerup',finish);el.addEventListener('pointercancel',finish);
   lane.append(el);
  }
  row.append(head,lane);$('trackContainer').append(row);
 }
 $('trackSelect').replaceChildren();
 for(const track of editor.tracks){const opt=document.createElement('option');opt.value=track.id;opt.textContent=track.name;$('trackSelect').append(opt)}
 $('counter').textContent=editor.tracks.length+' faixas • '+editor.tracks.reduce((n,t)=>n+t.clips.length,0)+' clipes';
 $('clock').textContent=timefmt(cursor)+' / '+timefmt(total());
 $('playhead').style.left=(95+cursor*p)+'px';
 $('selected').textContent=selectedClip?(()=>{try{const r=editor.clip(selectedClip);return editor.media[r.clip.mediaId].name+' • '+r.track.name}catch{return 'Nenhum'}})():'Nenhum';
 $('undo').disabled=!editor.history.length;$('redo').disabled=!editor.future.length;
}
function action(fn){try{fn();render()}catch(err){msg(err.message)}}
function addTrack(kind){action(()=>{editor.addTrack(kind);msg('Faixa '+kind+' criada')})}
$('addVideo').onclick=()=>addTrack('video');
$('addAudio').onclick=()=>addTrack('audio');
$('addOverlay').onclick=()=>addTrack('overlay');
function insert(){
 action(()=>{
  if(!selectedMedia)throw Error('Selecione uma mídia na biblioteca');
  let trackId=$('trackSelect').value;
  let track=editor.tracks.find(t=>t.id===trackId);
  const media=editor.media[selectedMedia];
  if(!track||track.kind!==media.kind&&track.kind!=='overlay'){
    track=editor.tracks.find(t=>t.kind===media.kind);
    if(!track)track=editor.track(editor.addTrack(media.kind));
  }
  const at=q(Number($('timeInput').value));
  selectedClip=editor.addClip(track.id,selectedMedia,at,{ripple:$('ripple').checked});
  seek(sec(at));msg('Mídia inserida em '+track.name);
 });
}
$('insert').onclick=insert;$('insertSmall').onclick=insert;
function split(){action(()=>{if(!selectedClip)throw Error('Selecione um clipe');const id=editor.split(selectedClip,q(cursor));selectedClip=id;msg('Clipe dividido')})}
$('split').onclick=split;$('splitSmall').onclick=split;
function remove(){action(()=>{if(!selectedClip)return;editor.remove(selectedClip,{ripple:$('ripple').checked});selectedClip=null;player.pause();player.removeAttribute('src');player.load();msg('Clipe removido da timeline')})}
$('remove').onclick=remove;$('removeSmall').onclick=remove;
$('move').onclick=()=>action(()=>{if(!selectedClip)throw Error('Selecione um clipe');const r=editor.clip(selectedClip);const at=q(Number($('moveInput').value));editor.move(selectedClip,r.track.id,at,{ripple:$('ripple').checked});seek(sec(at));msg('Clipe movido')});
$('undo').onclick=()=>{editor.undo();selectedClip=null;render();seek(Math.min(cursor,total()))};
$('redo').onclick=()=>{editor.redo();selectedClip=null;render();seek(Math.min(cursor,total()))};
$('zoom').oninput=render;
$('prev').onclick=()=>seek(0);$('next').onclick=()=>seek(Math.min(total(),cursor+5));
$('play').onclick=()=>{if(!player.src){preview();return}player.paused?player.play().catch(e=>msg(e.message)):player.pause()};
player.addEventListener('timeupdate',()=>{
 if(!player.src||!selectedClip)return;
 try{const {clip}=editor.clip(selectedClip);cursor=clamp(sec(clip.at+Math.max(0,Math.round(player.currentTime*editor.fps)-clip.inFrame)),0,total());
 $('clock').textContent=timefmt(cursor)+' / '+timefmt(total());$('playhead').style.left=(95+cursor*px())+'px';
 if(player.currentTime>=sec(clip.outFrame))player.pause();
 }catch{}
});
$('files').addEventListener('change',async e=>{
 for(const f of [...e.target.files]){
  const kind=f.type.startsWith('audio/')?'audio':f.type.startsWith('video/')?'video':null;
  if(!kind){msg('Formato não suportado: '+f.name);continue}
  const url=URL.createObjectURL(f);const probe=document.createElement(kind);
  probe.preload='metadata';probe.src=url;
  const duration=await new Promise(resolve=>{probe.onloadedmetadata=()=>resolve(probe.duration);probe.onerror=()=>resolve(0)});
  probe.removeAttribute('src');probe.load();
  if(!Number.isFinite(duration)||duration<=0){URL.revokeObjectURL(url);msg('Não foi possível ler '+f.name);continue}
  action(()=>{
   const id=editor.addMedia({name:f.name,kind,duration,sourceId:f.name+'|'+f.size+'|'+f.lastModified});
   files.set(id,{file:f,url});selectedMedia=id;
   if(!editor.tracks.some(t=>t.kind===kind))editor.addTrack(kind);
  });
 }
 renderMedia();render();e.target.value='';
});
function renderMedia(){
 const target=$('media');target.replaceChildren();
 for(const m of Object.values(editor.media)){
  const el=document.createElement('div');el.className='media-item'+(selectedMedia===m.id?' active':'');el.textContent=(m.kind==='audio'?'♫ ':'▣ ')+m.name;
  const meta=document.createElement('small');meta.textContent=timefmt(sec(m.frames));
  el.append(meta);el.onclick=()=>{selectedMedia=m.id;renderMedia()};target.append(el);
 }
}
$('save').onclick=()=>{
 const blob=new Blob([editor.toJSON()],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='video-enhancer-v2.veproj.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
 msg('Projeto salvo. Reimporte as mídias ao reabrir.');
};
$('openProject').onchange=async e=>{
 const f=e.target.files[0];if(!f)return;
 try{if(f.size>2_000_000)throw Error('JSON muito grande');
  for(const asset of files.values())URL.revokeObjectURL(asset.url);
  files.clear();editor=VE2Engine.Timeline.fromJSON(await f.text());selectedClip=null;selectedMedia=null;cursor=0;renderMedia();render();msg('Projeto aberto. Reimporte os arquivos de vídeo/áudio para habilitar a prévia.')
 }catch(err){msg('Erro: '+err.message)}finally{e.target.value=''}
};
window.addEventListener('keydown',e=>{
 if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;
 if(e.ctrlKey&&e.key.toLowerCase()==='z'){e.preventDefault();$('undo').click()}
 if(e.ctrlKey&&e.key.toLowerCase()==='y'){e.preventDefault();$('redo').click()}
 if(!e.ctrlKey&&e.key.toLowerCase()==='s'){e.preventDefault();split()}
 if(!e.ctrlKey&&e.key==='Delete'){e.preventDefault();remove()}
});
editor.addTrack('video','V1');
editor.addTrack('audio','A1');
render();
})();