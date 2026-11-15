(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state={layers:[],selected:null,busy:false,playing:false,lastTime:-1};
const bridge=()=>window.VideoEnhancerTimelineBridge;
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const px=()=>Number($('zoom').value)||65;
const active=()=>state.layers.find(c=>c.id===state.selected);
const canvas=$('overlayCanvasLayers'),trackRoot=$('overlayTimelineTracks');
const fields={at:'layerAt',start:'layerStart',end:'layerEnd',scale:'layerScale',
 opacity:'layerOpacity',x:'layerX',y:'layerY'};
const renderValue=(id,v)=>$(id).value=String(v);
function safeTime(t){return Math.max(0,Number(t)||0)}
function renderInspector(){
 const c=active();$('overlayInspector').hidden=!c;
 document.querySelector('.inspector')?.classList.toggle('layer-selected',!!c);
 if(!c)return;
 $('layerSelectionName').textContent=c.name;
 for(const [key,id] of Object.entries(fields)){
  const v=['scale','opacity','x','y'].includes(key)?Math.round(c[key]*100):c[key];
  renderValue(id,v);
 }
 $('layerScaleValue').textContent=Math.round(c.scale*100)+'%';
 $('layerOpacityValue').textContent=Math.round(c.opacity*100)+'%';
 $('layerToggleVisibility').textContent=c.hidden?'Mostrar':'Ocultar';
 $('layerToggleVisibility').setAttribute('aria-pressed',String(c.hidden));
}
function renderLibrary(){
 const root=$('layerLibrary');root.replaceChildren();
 for(const c of state.layers){
  const b=document.createElement('button');b.className='layer-asset'+(c.id===state.selected?' on':'');
  b.textContent='▧ '+c.name;b.title='Selecionar '+c.name;
  b.addEventListener('click',()=>select(c.id));root.appendChild(b);
 }
}
function renderTimeline(){
 trackRoot.replaceChildren();const scale=px(),length=bridge()?.total()||1;
 state.layers.slice().reverse().forEach((c,index)=>{
  const row=document.createElement('div');row.className='overlay-track-row';
  const label=document.createElement('div');label.className='track-label layer-label';
  const trackNumber=state.layers.indexOf(c)+2;
  const caption=document.createElement('strong');caption.textContent='▧ V'+trackNumber;
  const small=document.createElement('small');small.textContent=c.hidden?'Oculta':'Vídeo';
  label.append(caption,small);
  const body=document.createElement('div');body.className='overlay-track-body';
  const clip=document.createElement('div');
  clip.className='overlay-timeline-clip'+(c.id===state.selected?' selected':'');
  clip.style.left=(c.at*scale)+'px';
  clip.style.width=Math.max(14,(c.end-c.start)*scale)+'px';
  clip.style.opacity=c.hidden?'.35':'1';
  clip.textContent=c.name;clip.title='Arraste para mover a camada na timeline';
  clip.addEventListener('click',e=>{e.stopPropagation();select(c.id)});
  clip.addEventListener('pointerdown',e=>{
   if(e.button!==0)return;e.preventDefault();e.stopPropagation();state.selected=c.id;renderInspector();
   const ox=e.clientX,start=c.at,moved=0;
   clip.setPointerCapture(e.pointerId);
   const move=ev=>{
    moved=ev.clientX-ox;const fps=bridge()?.fps()||30;
    c.at=Math.round(clamp(start+moved/scale,0,Math.max(0,(bridge()?.total()||86400)-(c.end-c.start)))*fps)/fps;
    clip.style.left=c.at*scale+'px';renderInspector();sync(true);
   };
   const finish=()=>{clip.removeEventListener('pointermove',move);clip.removeEventListener('pointerup',finish);clip.removeEventListener('pointercancel',finish);render()};
   clip.addEventListener('pointermove',move);clip.addEventListener('pointerup',finish);clip.addEventListener('pointercancel',finish);
  });
  body.appendChild(clip);row.append(label,body);trackRoot.appendChild(row);
 });
 const stage=$('timelineStage');
 const height=Math.max(180,195+state.layers.length*64+($('audioTrack').hidden?0:64));
 stage.style.minHeight=height+'px';$('playhead').style.height=height+'px';
}
function select(id){state.selected=id;render();}
function render(){
 renderLibrary();renderTimeline();renderInspector();sync(true);
}
function sync(force=false){
 const t=bridge()?.cursor()||0,playing=!!bridge()?.playing();
 if(!force&&Math.abs(t-state.lastTime)<.012&&playing===state.playing)return;
 state.lastTime=t;state.playing=playing;
 const ids=new Set();
 for(const layer of state.layers){
  ids.add(layer.id);let host=canvas.querySelector('[data-overlay-id="'+layer.id+'"]');
  if(!host){
   host=document.createElement('div');host.className='overlay-preview-item';host.dataset.overlayId=layer.id;
   const video=document.createElement('video');video.src=layer.url;video.muted=true;video.playsInline=true;video.preload='metadata';video.loop=false;
   video.addEventListener('error',()=>{host.title='A prévia deste codec não é suportada pelo navegador; o FFmpeg ainda pode exportar.'});
   host.appendChild(video);
   host.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;state.selected=layer.id;renderInspector();
    e.preventDefault();e.stopPropagation();const bounds=canvas.getBoundingClientRect(),sx=e.clientX,sy=e.clientY,ox=layer.x,oy=layer.y;
    host.setPointerCapture(e.pointerId);
    const move=ev=>{layer.x=clamp(ox+(ev.clientX-sx)/Math.max(1,bounds.width-layer.scale*bounds.width),0,1);
      layer.y=clamp(oy+(ev.clientY-sy)/Math.max(1,bounds.height-host.clientHeight),0,1);position(layer,host);renderInspector()};
    const stop=()=>{render();host.removeEventListener('pointermove',move);host.removeEventListener('pointerup',stop);host.removeEventListener('pointercancel',stop)};
    host.addEventListener('pointermove',move);host.addEventListener('pointerup',stop);host.addEventListener('pointercancel',stop);
   });
   canvas.appendChild(host);
  }
  position(layer,host);
  const visible=!layer.hidden&&t>=layer.at&&t<layer.at+(layer.end-layer.start);
  host.hidden=!visible;
  const video=host.querySelector('video');
  if(!visible){if(!video.paused)video.pause();continue}
  const playTime=layer.start+(t-layer.at);
  if(Number.isFinite(video.duration)&&Math.abs(video.currentTime-playTime)>.10){
   try{video.currentTime=clamp(playTime,0,Math.max(0,video.duration-.03))}catch{}
  }
  if(playing&&video.paused){video.play().catch(()=>{})}
  if(!playing&&!video.paused)video.pause();
 }
 for(const host of [...canvas.children])if(!ids.has(host.dataset.overlayId)){host.querySelector('video')?.pause();host.remove()}
}
function position(c,host){
 host.classList.toggle('selected',c.id===state.selected);
 host.style.width=c.scale*100+'%';host.style.height='auto';
 const ratio=c.height/c.width;
 host.style.aspectRatio=c.width+'/'+c.height;
 host.style.left=(c.x*(1-c.scale)*100)+'%';
 host.style.top=(c.y*Math.max(0,canvas.clientHeight-canvas.clientWidth*c.scale*ratio))+'px';
 host.style.opacity=String(c.opacity);
}
async function importLayer(file){
 if(!file)return;if(!bridge()?.file()){alert('Importe primeiro o vídeo principal V1.');return}
 if(state.layers.length>=4){alert('O limite atual é de 4 camadas de sobreposição.');return}
 if(file.size>350*1024*1024){alert('Camada acima de 350 MB.');return}
 if(state.busy)return;state.busy=true;
 const button=$('importLayerFile');button.disabled=true;
 try{
  const form=new FormData();form.append('file',file);
  const res=await fetch('/api/editor/layers/upload',{method:'POST',body:form});
  const data=await res.json();if(!res.ok)throw Error(data.detail||'Falha ao importar camada');
  const duration=Math.min(data.duration,Math.max(.08,(bridge()?.total()||data.duration)-(bridge()?.cursor()||0)));
  const layer={id:data.id,name:data.name,url:data.url,width:data.width,height:data.height,duration:data.duration,
   at:Math.max(0,bridge()?.cursor()||0),start:0,end:duration,scale:.45,opacity:1,x:.5,y:.5,hidden:false};
  state.layers.push(layer);state.selected=layer.id;render();
 }catch(err){alert('Falha ao importar sobreposição: '+err.message)}
 finally{state.busy=false;button.disabled=false}
}
$('importLayerFile').addEventListener('change',e=>{const file=e.target.files?.[0];e.target.value='';importLayer(file)});
for(const [key,id] of Object.entries(fields)){
 $(id).addEventListener(['at','start','end'].includes(key)?'change':'input',()=>{
  const c=active();if(!c)return;const val=Number($(id).value);
  if(!Number.isFinite(val))return;
  c[key]=['scale','opacity','x','y'].includes(key)?clamp(val/100,key==='scale'?.1:0,1):Math.max(0,val);
  if(key==='at')c.at=Math.min(c.at,Math.max(0,(bridge()?.total()||c.at+c.end-c.start)-(c.end-c.start)));
  if(c.start>c.duration-.08)c.start=Math.max(0,c.duration-.08);
  if(c.end<=c.start)c.end=c.start+.08;
  if(c.end>c.duration)c.end=Math.max(c.start+.08,c.duration);
  render();
 });
}
$('layerToggleVisibility').addEventListener('click',()=>{const c=active();if(c){c.hidden=!c.hidden;render()}});
$('layerDelete').addEventListener('click',()=>{state.layers=state.layers.filter(c=>c.id!==state.selected);state.selected=state.layers.at(-1)?.id||null;render()});
function reset(){state.layers=[];state.selected=null;render()}
function clearSelection(){state.selected=null;document.querySelector('.inspector')?.classList.remove('layer-selected')}
function serialize(){return state.layers.map(c=>({...c}))}
function restore(project){
 state.layers=Array.isArray(project?.videoLayers)?project.videoLayers.slice(0,4).filter(c=>c&&typeof c.id==='string'&&/^\/api\/editor\/layers\/media\/[a-f0-9]{32}$/.test(c.url)).map(c=>({...c,hidden:!!c.hidden})):[];
 state.selected=state.layers.at(-1)?.id||null;render();
}
function appendExport(form){form.append('video_overlays',JSON.stringify(state.layers.map(c=>({
 id:c.id,at:c.at,start:c.start,end:c.end,x:c.x,y:c.y,
 scale:c.scale,opacity:c.opacity,hidden:c.hidden
}))))}
// Tabs navigate only to real, implemented panels.
for(const button of document.querySelectorAll('.editor-tabs button[data-panel-target]')){
 button.addEventListener('click',()=>{
  document.querySelectorAll('.editor-tabs button').forEach(x=>x.classList.toggle('tab-active',x===button));
  const target=$(button.dataset.panelTarget);
  target?.scrollIntoView({block:'start',behavior:'smooth'});
 });
}
window.VideoEnhancerLayers={render,reset,clearSelection,serialize,restore,appendExport,sync};
setInterval(()=>sync(),75);
render();
})();