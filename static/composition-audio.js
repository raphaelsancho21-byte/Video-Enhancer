(()=>{
'use strict';
const $=id=>document.getElementById(id);
const video=$('player');
const audio=document.createElement('audio');
audio.preload='auto';
audio.style.display='none';
document.body.appendChild(audio);
const state={width:0,height:0,sourceWidth:0,sourceHeight:0,fps:30,asset:null,
 at:0,volume:1,muted:false,analysis:null,pending:null,drag:null,raf:0};
const bridge=()=>window.VideoEnhancerTimelineBridge;
const snapF=n=>Math.round(n*state.fps)/state.fps;
const clamp=(x,min,max)=>Math.min(max,Math.max(min,x));
const dimensionsValid=(w,h)=>Number.isInteger(w)&&Number.isInteger(h)&&w>=64&&w<=4096&&h>=64&&h<=4096&&w%2===0&&h%2===0;
function initSize(w,h){
 state.sourceWidth=w;state.sourceHeight=h;
 state.width=w;state.height=h;
 if(!$('compositionWidth')||!w)return;
 $('compositionWidth').value=w;$('compositionHeight').value=h;$('compositionPreset').value='source';
 $('projectFps').value=String(state.fps);
 applyDimensions(w,h,true);
}
function applyDimensions(w,h,initial=false){
 if(!dimensionsValid(w,h)){announce('Use dimensões pares entre 64 e 4096 pixels.');return false}
 const oldW=state.width||w,oldH=state.height||h;
 const changed=w!==oldW||h!==oldH;
 state.width=w;state.height=h;
 const clips=bridge()?.clips()||[];
 if(changed&&!initial){
  bridge()?.snapshot();
  for(const c of clips){
   if(!c.transform){c.transform={x:oldW/2,y:oldH/2,width:state.sourceWidth,height:state.sourceHeight,rotation:0}}
   c.transform={...c.transform,x:c.transform.x*w/oldW,y:c.transform.y*h/oldH,
    width:c.transform.width*Math.min(w/oldW,h/oldH),
    height:c.transform.height*Math.min(w/oldW,h/oldH)};
  }
 }
 window.VideoEnhancerCanvas?.dimension(w,h);
 // Force reload of current clip's transform against the new comp dimensions.
 window.dispatchEvent(new CustomEvent('video-enhancer-composition-change',{detail:{width:w,height:h}}));
 $('resolutionInfo').textContent=w+'×'+h+' · composição';
 $('compositionWidth').value=w;$('compositionHeight').value=h;
 const isSource=w===state.sourceWidth&&h===state.sourceHeight;
 $('exportResolution').value='original';
 $('exportResolution').disabled=!isSource;
 $('exportResolution').title=isSource?'':'A composição define a resolução exata da exportação';
 return true;
}
function onPreset(){
 const preset=$('compositionPreset').value;
 if(preset==='source'){applyDimensions(state.sourceWidth,state.sourceHeight);return}
 if(preset==='custom')return;
 const [w,h]=preset.split('x').map(Number);applyDimensions(w,h);
}
$('compositionPreset').addEventListener('change',onPreset);
for(const field of ['compositionWidth','compositionHeight'])$(field).addEventListener('change',()=>{
 const w=Number($('compositionWidth').value),h=Number($('compositionHeight').value);
 if(applyDimensions(w,h))$('compositionPreset').value='custom';
});
$('projectFps').addEventListener('change',()=>{state.fps=Number($('projectFps').value);bridge()?.render()});
function announce(msg){$('audioAssetInfo').textContent=msg}
const waveform=()=>{const canvas=$('audioWave'),clip=$('audioClip'),t=state.analysis;const ctx=canvas.getContext('2d');const width=Math.max(1,Math.min(4096,Math.ceil((audio.duration||bridge()?.total()||0)*Number($('zoom').value))));
 canvas.width=width;canvas.style.width=(audio.duration||bridge()?.total()||0)*Number($('zoom').value)+'px';ctx.clearRect(0,0,width,45);
 if(!t?.waveform?.length)return;
 ctx.fillStyle='#72e6bf';
 const d=t.duration||audio.duration||1;
 t.waveform.forEach((v,i)=>{
  const x=Math.round((i/t.waveform.length)*d*Number($('zoom').value));
  const hh=Math.max(1,Math.min(20,v*60));ctx.fillRect(x,23-hh,1,2*hh);
 });
};
function update(){
 const track=$('audioTrack');
 track.hidden=!state.asset;
 $('extractAudio').disabled=!bridge()?.file();
 if(!state.asset)return;
 const duration=Number.isFinite(audio.duration)?audio.duration:bridge()?.sourceDuration()||0;
 $('audioClip').style.left=(state.at*Number($('zoom').value))+'px';
 $('audioClip').style.width=Math.max(18,duration*Number($('zoom').value))+'px';
 $('audioClipName').textContent=state.asset.name||'Áudio extraído';
 $('audioMuteBtn').classList.toggle('muted',state.muted);
 $('audioMuteBtn').setAttribute('aria-pressed',String(state.muted));
 $('audioMuteBtn').textContent=state.muted?'🔇':'♫';
 $('audioVolume').value=String(Math.round(state.volume*100));
 waveform();
}
function syncPlayback(){
 if(!state.asset)return;
 const playhead=bridge()?.cursor()||0;
 const shouldPlay=bridge()?.playing()&&playhead>=state.at&&playhead<state.at+audio.duration&&!state.muted;
 const position=clamp(playhead-state.at,0,Math.max(0,(audio.duration||0)-.001));
 if(Math.abs(audio.currentTime-position)>.19){try{audio.currentTime=position}catch{}}
 audio.volume=clamp(state.volume,0,1);
 if(shouldPlay&&audio.paused){audio.play().catch(()=>{})}
 if(!shouldPlay&&!audio.paused)audio.pause();
}
function clock(){
 state.raf=requestAnimationFrame(clock);
 if(!state.asset)return;
 // Checking only inexpensive playback state; waveform/beat analysis is not repeated here.
 syncPlayback();
}
function loadAsset(data,restore=false){
 audio.pause();audio.src=data.url;audio.load();state.asset=data;
 state.at=restore?state.at:0;state.muted=false;state.volume=1;state.analysis=null;
 video.muted=true;
 audio.addEventListener('loadedmetadata',()=>{update()}, {once:true});
 update();
}
$('extractAudio').addEventListener('click',async()=>{
 const file=bridge()?.file();if(!file)return;
 const btn=$('extractAudio');btn.disabled=true;btn.textContent='Extraindo áudio...';announce('Extraindo no servidor; nenhum download será iniciado.');
 try{
  const form=new FormData();form.append('file',file);
  const res=await fetch('/api/editor/extract-audio',{method:'POST',body:form});
  const data=await res.json();if(!res.ok)throw Error(data.detail||'Erro ao extrair');
  loadAsset(data);
  announce('Áudio extraído para a faixa A1. Use Detectar batidas para analisar.');
  $('detectBeats').disabled=false;bridge()?.render();
 }catch(err){announce('Erro: '+err.message)}
 finally{btn.disabled=!bridge()?.file();btn.textContent='♫ Extrair áudio para o projeto'}
});
$('audioMuteBtn').addEventListener('click',()=>{state.muted=!state.muted;update()});
$('audioVolume').addEventListener('input',()=>{state.volume=Number($('audioVolume').value)/100;audio.volume=Math.min(1,state.volume)});
$('removeAudio').addEventListener('click',()=>{state.asset=null;state.analysis=null;audio.pause();audio.removeAttribute('src');audio.load();video.muted=false;announce('Áudio removido da faixa A1.');update();bridge()?.render()});
audio.addEventListener('loadedmetadata',update);
$('zoom').addEventListener('input',update);
$('audioClip').addEventListener('pointerdown',e=>{
 if(e.button!==0)return;
 e.preventDefault();
 $('audioClip').setPointerCapture(e.pointerId);
 state.drag={id:e.pointerId,x:e.clientX,at:state.at};
});
$('audioClip').addEventListener('pointermove',e=>{
 const drag=state.drag;if(!drag||drag.id!==e.pointerId)return;
 const at=clamp(snapF(drag.at+(e.clientX-drag.x)/Number($('zoom').value)),0,24*3600);
 state.at=at;
 $('audioClip').style.left=(at*Number($('zoom').value))+'px';
 window.TimelineSmart?.shiftDetected?.(at);
});
$('audioClip').addEventListener('pointerup',e=>{if(state.drag?.id===e.pointerId){state.drag=null;update()}});
$('audioClip').addEventListener('pointercancel',()=>state.drag=null);
function resetForMedia(){
 state.asset=null;state.analysis=null;state.at=0;state.volume=1;state.muted=false;
 audio.pause();audio.removeAttribute('src');audio.load();video.muted=false;
 state.fps=30;update();
}
function serialize(){
 return {composition:{width:state.width,height:state.height,fps:state.fps},
  audio:state.asset?{...state.asset,at:state.at,volume:state.volume,muted:state.muted}:null};
}
function restore(data){
 const obj=data?.projectMedia;if(!obj)return;
 if(obj.composition){
  const {width,height,fps}=obj.composition;
  if([24,25,30,60].includes(Number(fps))){state.fps=Number(fps);$('projectFps').value=String(fps)}
  if(dimensionsValid(width,height)){applyDimensions(width,height);$('compositionPreset').value='custom'}
 }
 if(obj.audio?.id&&typeof obj.audio.url==='string'){
  const setting=obj.audio;
  state.at=Number(setting.at)||0;
  loadAsset(setting,true);
  state.volume=clamp(Number(setting.volume??1),0,2);
  state.muted=!!setting.muted;update();
  announce('Áudio do projeto restaurado (se o arquivo local ainda existir).');
 }
}
function appendExport(form){
 form.append('composition',JSON.stringify({width:state.width,height:state.height,fps:state.fps}));
 if(state.asset&&!state.muted&&!$('muteExport').checked){
  form.append('extracted_audio',JSON.stringify({id:state.asset.id,at:state.at,volume:state.volume}));
 }
 if(state.asset&&state.muted)form.set('mute','true');
}
window.VideoEnhancerProjectMedia={initialize:initSize,resetForMedia,serialize,restore,appendExport,update,
 getAudio:()=>state.asset,getAudioAt:()=>state.at,
 acceptAnalysis:analysis=>{state.analysis=analysis;waveform()},getComposition:()=>({width:state.width,height:state.height,fps:state.fps})};
window.addEventListener('video-enhancer-timeline-update',update);
requestAnimationFrame(clock);
})();