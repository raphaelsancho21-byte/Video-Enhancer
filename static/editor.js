(() => {
const $ = id => document.getElementById(id);
const video = $('player');
const pixels = () => Number($('zoom').value);
let file = null, sourceUrl = '', sourceDuration = 0, clips = [], selected = -1, cursor = 0, playing = false, editing = false, dragging = null, undo = [], redo = [], toastTimeout, thumbnails=[], pendingProject=null;
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const dlen = c => (c.end-c.start)/c.speed;
const total = () => clips.reduce((sum,c)=>sum+dlen(c),0);
const fmt = t => {t=Math.max(0,t||0);return String(Math.floor(t/60)).padStart(2,'0')+':'+String(Math.floor(t%60)).padStart(2,'0')+'.'+String(Math.floor((t%1)*100)).padStart(2,'0')};
const notify = text => {const n=$('toast');n.textContent=text;n.hidden=false;clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>n.hidden=true,3400)};
const snapshot = () => {undo.push(clips.map(c=>({...c})));if(undo.length>50)undo.shift();redo=[]};
const restore = (stack,other) => {if(!stack.length)return;other.push(clips.map(c=>({...c})));clips=stack.pop();selected=clips.length?Math.min(Math.max(selected,0),clips.length-1):-1;seek(Math.min(cursor,total()));render()};
const timelineSnap = (value, points, radius=.12) => {const target=points.find(x=>Math.abs(x-value)<radius);return target===undefined?value:target};
const locate = t => {let sum=0;for(let i=0;i<clips.length;i++){let duration=dlen(clips[i]);if(t<sum+duration || i===clips.length-1)return {index:i,local:clamp(t-sum,0,duration),at:sum};sum+=duration}return null};
function syncVideo(force=false) {
 const loc=locate(cursor);
 if(!loc){video.pause();playing=false;return}
 const clip=clips[loc.index],pos=clip.start+loc.local*clip.speed;
 video.playbackRate=clip.speed;
 if(force || Math.abs(video.currentTime-pos)>.13) video.currentTime=pos;
}
function seek(t,force=true){cursor=clamp(t,0,total());syncVideo(force);paintPlayhead()}
function paintPlayhead(){const x=90+cursor*pixels();$('playhead').style.left=x+'px';$('clock').textContent=fmt(cursor)+' / '+fmt(total())}
function render() {
 const p=pixels(), length=total();
 $('clips').replaceChildren();
 let offset=0;
 clips.forEach((c,i)=>{
  const clipOffset=offset;const el=document.createElement('div');el.className='clip'+(i===selected?' selected':'');el.style.width=Math.max(4,dlen(c)*p)+'px';el.draggable=true;el.dataset.index=i;
  el.innerHTML='<div class="filmstrip"></div><div class="trim left"></div><div class="clip-name"></div><div class="clip-duration"></div><div class="trim right"></div>';
  const strip=el.querySelector('.filmstrip');
  if(thumbnails.length)strip.style.backgroundImage='url("'+thumbnails[Math.min(thumbnails.length-1,Math.floor((c.start/sourceDuration)*thumbnails.length))]+'")';
  el.querySelector('.clip-name').textContent=(file?.name||'Vídeo')+' · '+(i+1);
  el.querySelector('.clip-duration').textContent=fmt(dlen(c));
  el.addEventListener('click',e=>{if(dragging)return;selected=i;if(!e.target.classList.contains('trim'))seek(clipOffset+clamp((e.clientX-el.getBoundingClientRect().left)/p,0,dlen(c)));render()});
  el.addEventListener('dragstart',e=>{if(editing){e.preventDefault();return}dragging=i;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(i));el.classList.add('dragging')});
  el.addEventListener('dragover',e=>e.preventDefault());
  el.addEventListener('drop',e=>{e.preventDefault();const from=dragging;dragging=null;if(from===null||from===i)return;snapshot();const [moved]=clips.splice(from,1);clips.splice(i,0,moved);selected=i;seek(0);render();notify('Trechos reordenados')});
  el.addEventListener('dragend',()=>{dragging=null;el.classList.remove('dragging')});
  for(const side of ['left','right'])el.querySelector('.trim.'+side).addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();selected=i;editing=true;const origin=e.clientX,original={...c};snapshot();const move=ev=>{
    let delta=(ev.clientX-origin)/p*c.speed;
    if(side==='left')c.start=clamp(timelineSnap(original.start+delta,clips.flatMap(x=>[x.start,x.end]),.10),0,c.end-.08);
    else c.end=clamp(timelineSnap(original.end+delta,clips.flatMap(x=>[x.start,x.end]),.10),c.start+.08,sourceDuration);
    render();seek(Math.min(cursor,total()));};
    const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);editing=false;render()};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
  });
  $('clips').appendChild(el);offset+=dlen(c)
 });
 $('clips').style.width=Math.max(length*p,200)+'px';
 $('timelineStage').style.width=Math.max(90+length*p+110,$('timelineScroll').clientWidth)+'px';
 const ruler=$('ruler');ruler.replaceChildren();
 const step=p>=90?1:p>=45?2:5;
 for(let s=0;s<=length+1;s+=step){const tick=document.createElement('span');tick.className='tick';tick.style.left=(s*p)+'px';tick.textContent=fmt(s).slice(0,5);ruler.appendChild(tick)}
 $('segmentCount').textContent=clips.length+' trecho(s)';$('durationLabel').textContent=fmt(length);
 $('exportBtn').disabled=clips.length===0;$('splitBtn').disabled=clips.length===0;$('deleteBtn').disabled=selected<0;$('undoBtn').disabled=undo.length===0;$('redoBtn').disabled=redo.length===0;
 $('noSelection').hidden=selected>=0;$('clipInspector').hidden=selected<0;
 if(selected>=0){const c=clips[selected];$('clipIndex').textContent='#'+(selected+1);$('startField').value=c.start.toFixed(2);$('endField').value=c.end.toFixed(2);$('speedField').value=String(c.speed)}
 paintPlayhead();
}
function split(){
 const at=locate(cursor);if(!at)return;
 const c=clips[at.index],sourcePos=c.start+at.local*c.speed;
 if(sourcePos<=c.start+.08||sourcePos>=c.end-.08){notify('Posicione a linha de corte dentro de um trecho');return}
 snapshot();clips.splice(at.index,1,{...c,end:sourcePos},{...c,start:sourcePos});selected=at.index+1;render();notify('Trecho dividido');
}
function remove(){
 if(selected<0)return;snapshot();clips.splice(selected,1);selected=clips.length?Math.min(selected,clips.length-1):-1;seek(Math.min(cursor,total()));render();
}
function updateField(){
 if(selected<0)return;
 let c=clips[selected];let st=Number($('startField').value),en=Number($('endField').value),speed=Number($('speedField').value);
 if(!Number.isFinite(st)||!Number.isFinite(en)||st<0||en>sourceDuration||en-st<.08||![.5,1,1.5,2].includes(speed)){notify('Confira início, fim e velocidade do trecho');render();return}
 snapshot();c.start=st;c.end=en;c.speed=speed;seek(Math.min(cursor,total()));render();
}
async function importFile(f){
 if(!f)return;
 if(f.size>1024*1024*1024){notify('Limite de 1 GB por vídeo');return}
 if(sourceUrl)URL.revokeObjectURL(sourceUrl);
 file=f;sourceUrl=URL.createObjectURL(f);video.pause();video.src=sourceUrl;video.load();
 await new Promise((res,rej)=>{video.onloadedmetadata=res;video.onerror=()=>rej(Error('Formato não reproduzível pelo navegador'))}).catch(err=>notify(err.message));
 if(!Number.isFinite(video.duration)||video.duration<=0){file=null;return}
 sourceDuration=video.duration;clips=[{start:0,end:sourceDuration,speed:1}];selected=0;cursor=0;undo=[];redo=[];thumbnails=[];playing=false;
 if(pendingProject){const project=pendingProject;pendingProject=null;applyProject(project)}
 $('emptyPreview').hidden=true;$('asset').classList.remove('empty');$('asset').querySelector('.asset-thumb').textContent='▶';$('asset').querySelector('.asset-caption').textContent=f.name;
 $('resolutionInfo').textContent=video.videoWidth+'×'+video.videoHeight;render();seek(0);notify('Vídeo importado');makeThumbnails(sourceUrl).then(imgs=>{if(sourceUrl&&imgs.length){thumbnails=imgs;render()}}).catch(()=>{});
}
$('importFile').addEventListener('change',e=>importFile(e.target.files[0]));
$('splitBtn').addEventListener('click',split);$('deleteBtn').addEventListener('click',remove);$('removeBtn').addEventListener('click',remove);
$('duplicateBtn').addEventListener('click',()=>{if(selected<0)return;snapshot();clips.splice(selected+1,0,{...clips[selected]});selected++;render()});
$('undoBtn').addEventListener('click',()=>restore(undo,redo));
$('redoBtn').addEventListener('click',()=>restore(redo,undo));
for(const id of ['startField','endField','speedField'])$(id).addEventListener('change',updateField);
$('zoom').addEventListener('input',render);
$('previewVolume').addEventListener('input',e=>video.volume=Number(e.target.value)/100);
function toggle(){if(!clips.length)return;if(playing){video.pause();playing=false}else{if(cursor>=total()-.02)seek(0);playing=true;syncVideo(true);video.play().catch(()=>{playing=false})}paintControl()}
function paintControl(){$('playBtn').textContent=playing?'Ⅱ':'▶'}
$('playBtn').addEventListener('click',toggle);$('backBtn').addEventListener('click',()=>seek(0));$('forwardBtn').addEventListener('click',()=>seek(cursor+5));
video.addEventListener('ended',()=>{if(!playing)return;const at=locate(cursor);if(at&&at.index<clips.length-1){cursor=at.at+dlen(clips[at.index])+.001;syncVideo(true);video.play().catch(()=>{playing=false;paintControl()})}else{playing=false;video.pause();cursor=total();paintControl();paintPlayhead()}});
video.addEventListener('timeupdate',()=>{
 if(!playing)return;
 let at=locate(cursor);if(!at){playing=false;video.pause();paintControl();return}
 let c=clips[at.index],approx=clamp((video.currentTime-c.start)/c.speed,0,dlen(c));
 cursor=at.at+approx;
 if(video.currentTime>=c.end-.045){
   const next=at.index+1;if(next>=clips.length){cursor=total();playing=false;video.pause();paintControl()}
   else {cursor=at.at+dlen(c)+.001;syncVideo(true);video.play().catch(()=>{playing=false;paintControl()})}
 }
 paintPlayhead();
});
$('ruler').addEventListener('pointerdown',e=>{const rect=$('ruler').getBoundingClientRect();seek((e.clientX-rect.left)/pixels());const move=ev=>seek((ev.clientX-rect.left)/pixels());const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)});
document.addEventListener('keydown',e=>{const active=document.activeElement;if(['INPUT','TEXTAREA','SELECT'].includes(active?.tagName))return;
 if(e.ctrlKey && e.key.toLowerCase()==='z'){e.preventDefault();$('undoBtn').click();return}
 if(e.ctrlKey && e.key.toLowerCase()==='y'){e.preventDefault();$('redoBtn').click();return}
 if(e.ctrlKey||e.metaKey||e.altKey)return;
 if(e.code==='Space'){e.preventDefault();toggle()}else if(e.key.toLowerCase()==='s')split();else if(e.key==='Delete'||e.key==='Backspace')remove();else if(e.key==='ArrowRight')seek(cursor+1/30);else if(e.key==='ArrowLeft')seek(cursor-1/30)});
function projectData(){
 return {format:'video-enhancer-project',version:1,title:$('projectName').value,
  media:file?{name:file.name,size:file.size,duration:sourceDuration}:null,
  clips:clips.map(c=>({...c})),settings:{quality:$('exportQuality').value,resolution:$('exportResolution').value,fps:$('exportFps').value,mute:$('muteExport').checked}};
}
function applyProject(data){
 if(!data||data.format!=='video-enhancer-project'||!Array.isArray(data.clips)||data.clips.length>100||!data.clips.length){notify('Projeto JSON inválido');return}
 if(!file){pendingProject=data;notify('Projeto carregado. Importe agora o arquivo de vídeo original.');return}
 if(data.media&&(data.media.name!==file.name||data.media.size!==file.size)){notify('Importe o vídeo original indicado no projeto: '+data.media.name);pendingProject=data;return}
 if(!data.clips.every(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&Number.isFinite(c.speed)&&c.start>=0&&c.end>c.start&&c.end<=sourceDuration+.1&&[.5,1,1.5,2].includes(c.speed))){notify('Tempos inválidos no projeto');return}
 snapshot();clips=data.clips.map(c=>({start:c.start,end:Math.min(c.end,sourceDuration),speed:c.speed}));selected=clips.length?0:-1;
 $('projectName').value=String(data.title||'Meu projeto').slice(0,70);
 if(data.settings){for(const key of ['quality','resolution','fps']){const id='export'+key[0].toUpperCase()+key.slice(1);if($(id)&&[...$(id).options].some(o=>o.value===data.settings[key]))$(id).value=data.settings[key]}$('muteExport').checked=!!data.settings.mute}
 seek(0);render();notify('Projeto aberto com sucesso');
}
$('saveProject').addEventListener('click',()=>{
 if(!file){notify('Importe um vídeo antes de salvar o projeto');return}
 const blob=new Blob([JSON.stringify(projectData(),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);
 const link=document.createElement('a');link.href=url;link.download=($('projectName').value.replace(/[^a-z0-9_-]/gi,'-')||'projeto')+'.veproj.json';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);notify('Projeto JSON salvo');
});
$('loadProject').addEventListener('change',async e=>{
 const f=e.target.files[0];if(!f)return;
 try{if(f.size>100000)throw Error('Projeto JSON muito grande');applyProject(JSON.parse(await f.text()))}catch(err){notify('Não foi possível abrir o projeto: '+err.message)}
 e.target.value='';
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function jsonResponse(url,options){const response=await fetch(url,options);let data;try{data=await response.json()}catch{throw Error('Resposta inválida do servidor')}if(!response.ok)throw Error(data.detail||'Falha no servidor');return data}
$('exportBtn').addEventListener('click',async()=>{
 if(!file||!clips.length)return;
 playing=false;video.pause();paintControl();
 $('exportModal').hidden=false;$('closeModal').disabled=true;$('download').hidden=true;$('exportFill').style.width='0%';$('exportPercent').textContent='0%';$('exportStatus').textContent='Enviando vídeo...';$('exportBtn').disabled=true;
 try{
  const form=new FormData();form.append('file',file);
  form.append('clips',JSON.stringify(clips));form.append('quality',$('exportQuality').value);form.append('resolution',$('exportResolution').value);form.append('fps',$('exportFps').value);form.append('mute',String($('muteExport').checked));
  const job=await jsonResponse('/api/editor/export',{method:'POST',body:form});
  while(true){const result=await jsonResponse('/api/jobs/'+job.id);$('exportStatus').textContent=result.stage;$('exportFill').style.width=result.progress+'%';$('exportPercent').textContent=result.progress+'%';if(result.status==='error')throw Error(result.error||'Erro ao exportar');if(result.status==='done'){$('download').href=result.download;$('download').hidden=false;$('exportStatus').textContent='Exportação concluída!';break}await sleep(1200)}
 }catch(e){$('exportStatus').textContent='Erro: '+e.message;notify('Exportação falhou')}
 finally{$('closeModal').disabled=false;$('exportBtn').disabled=false}
});
$('closeModal').addEventListener('click',()=>$('exportModal').hidden=true);
async function makeThumbnails(url){
 const probe=document.createElement('video');probe.muted=true;probe.preload='auto';probe.src=url;
 await new Promise((resolve,reject)=>{probe.onloadedmetadata=resolve;probe.onerror=reject});
 const canvas=document.createElement('canvas');canvas.width=112;canvas.height=64;const ctx=canvas.getContext('2d');const frames=[];
 try {
  const amount=Math.min(12,Math.max(3,Math.ceil(probe.duration/5)));
  for(let i=0;i<amount;i++){
   const at=Math.min(probe.duration-.05,(i+.5)*probe.duration/amount);
   await new Promise(resolve=>{const done=()=>resolve();probe.addEventListener('seeked',done,{once:true});probe.currentTime=Math.max(0,at);setTimeout(()=>{probe.removeEventListener('seeked',done);resolve()},1600)});
   ctx.fillStyle='#0e1521';ctx.fillRect(0,0,112,64);
   if(probe.videoWidth&&probe.videoHeight){const scale=Math.max(112/probe.videoWidth,64/probe.videoHeight);const w=probe.videoWidth*scale,h=probe.videoHeight*scale;ctx.drawImage(probe,(112-w)/2,(64-h)/2,w,h)}
   frames.push(canvas.toDataURL('image/jpeg',.55));
  }
 }finally{probe.pause();probe.removeAttribute('src');probe.load()}
 return frames;
}
window.addEventListener('resize',render);render();
})();