(() => {
const $ = id => document.getElementById(id);
const video = $('player');
const pixels = () => Number($('zoom').value);
let file = null, sourceUrl = '', sourceDuration = 0, clips = [], selected = -1, cursor = 0, playing = false, editing = false, dragging = null, undo = [], toastTimeout;
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const dlen = c => (c.end-c.start)/c.speed;
const total = () => clips.reduce((sum,c)=>sum+dlen(c),0);
const fmt = t => {t=Math.max(0,t||0);return String(Math.floor(t/60)).padStart(2,'0')+':'+String(Math.floor(t%60)).padStart(2,'0')+'.'+String(Math.floor((t%1)*100)).padStart(2,'0')};
const notify = text => {const n=$('toast');n.textContent=text;n.hidden=false;clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>n.hidden=true,3400)};
const snapshot = () => {undo.push(clips.map(c=>({...c})));if(undo.length>50)undo.shift()};
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
  el.innerHTML='<div class="trim left"></div><div class="clip-name"></div><div class="clip-duration"></div><div class="trim right"></div>';
  el.querySelector('.clip-name').textContent=(file?.name||'Vídeo')+' · '+(i+1);
  el.querySelector('.clip-duration').textContent=fmt(dlen(c));
  el.addEventListener('click',e=>{if(dragging)return;selected=i;if(!e.target.classList.contains('trim'))seek(clipOffset+clamp(e.offsetX/p,0,dlen(c)));render()});
  el.addEventListener('dragstart',e=>{if(editing){e.preventDefault();return}dragging=i;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(i));el.classList.add('dragging')});
  el.addEventListener('dragover',e=>e.preventDefault());
  el.addEventListener('drop',e=>{e.preventDefault();const from=dragging;dragging=null;if(from===null||from===i)return;snapshot();const [moved]=clips.splice(from,1);clips.splice(i,0,moved);selected=i;seek(0);render();notify('Trechos reordenados')});
  el.addEventListener('dragend',()=>{dragging=null;el.classList.remove('dragging')});
  for(const side of ['left','right'])el.querySelector('.trim.'+side).addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();selected=i;editing=true;const origin=e.clientX,original={...c};snapshot();const move=ev=>{
    let delta=(ev.clientX-origin)/p*c.speed;
    if(side==='left')c.start=clamp(original.start+delta,0,c.end-.08);
    else c.end=clamp(original.end+delta,c.start+.08,sourceDuration);
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
 $('exportBtn').disabled=clips.length===0;$('splitBtn').disabled=clips.length===0;$('deleteBtn').disabled=selected<0;$('undoBtn').disabled=undo.length===0;
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
 sourceDuration=video.duration;clips=[{start:0,end:sourceDuration,speed:1}];selected=0;cursor=0;undo=[];playing=false;
 $('emptyPreview').hidden=true;$('asset').classList.remove('empty');$('asset').querySelector('.asset-thumb').textContent='▶';$('asset').querySelector('.asset-caption').textContent=f.name;
 $('resolutionInfo').textContent=video.videoWidth+'×'+video.videoHeight;render();seek(0);notify('Vídeo importado');
}
$('importFile').addEventListener('change',e=>importFile(e.target.files[0]));
$('splitBtn').addEventListener('click',split);$('deleteBtn').addEventListener('click',remove);$('removeBtn').addEventListener('click',remove);
$('duplicateBtn').addEventListener('click',()=>{if(selected<0)return;snapshot();clips.splice(selected+1,0,{...clips[selected]});selected++;render()});
$('undoBtn').addEventListener('click',()=>{if(!undo.length)return;clips=undo.pop();selected=-1;seek(Math.min(cursor,total()));render()});
for(const id of ['startField','endField','speedField'])$(id).addEventListener('change',updateField);
$('zoom').addEventListener('input',render);
$('previewVolume').addEventListener('input',e=>video.volume=Number(e.target.value)/100);
function toggle(){if(!clips.length)return;if(playing){video.pause();playing=false}else{if(cursor>=total()-.02)seek(0);playing=true;syncVideo(true);video.play().catch(()=>{playing=false})}paintControl()}
function paintControl(){$('playBtn').textContent=playing?'Ⅱ':'▶'}
$('playBtn').addEventListener('click',toggle);$('backBtn').addEventListener('click',()=>seek(0));$('forwardBtn').addEventListener('click',()=>seek(cursor+5));
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
document.addEventListener('keydown',e=>{const active=document.activeElement;if(['INPUT','TEXTAREA','SELECT'].includes(active?.tagName)||e.ctrlKey&&e.key.toLowerCase()!=='z')return;
 if(e.code==='Space'){e.preventDefault();toggle()}else if(e.key.toLowerCase()==='s')split();else if(e.key==='Delete'||e.key==='Backspace')remove();else if(e.ctrlKey&&e.key.toLowerCase()==='z'){e.preventDefault();$('undoBtn').click()}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function jsonResponse(url,options){const response=await fetch(url,options);let data;try{data=await response.json()}catch{throw Error('Resposta inválida do servidor')}if(!response.ok)throw Error(data.detail||'Falha no servidor');return data}
$('exportBtn').addEventListener('click',async()=>{
 if(!file||!clips.length)return;
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
window.addEventListener('resize',render);render();
})();