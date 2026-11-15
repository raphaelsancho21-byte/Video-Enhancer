(()=>{
'use strict';
const $=id=>document.getElementById(id);
const bridge=()=>window.VideoEnhancerTimelineBridge;
const pane=$('effectPreviewPane'), preview=$('effectPreviewPlayer');
const button=$('previewEffectsBtn'), status=$('effectPreviewStatus');
let counter=0, active=false;
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const even=n=>Math.max(64,Math.round(n/2)*2);
const fmt=s=>s.toFixed(1)+' s';
function hide(){
 counter++;active=false;pane.hidden=true;preview.pause();
 preview.removeAttribute('src');preview.load();
 button.disabled=false;button.textContent='◉ Prévia dos efeitos';
}
async function responseJson(url,options){
 const r=await fetch(url,options);let d;
 try{d=await r.json()}catch{throw Error('Resposta inesperada do servidor')}
 if(!r.ok)throw Error(d.detail||'HTTP '+r.status);
 return d;
}
function trimWindow(){
 const B=bridge(), clips=B.clips(), t=B.cursor(),fps=B.fps();
 const located=clips.find(c=>t>=(c.at||0)-.000001 && t<(c.at||0)+(c.end-c.start)/c.speed-.000001);
 if(!located)return null;
 const at=located.at||0, clipDuration=(located.end-located.start)/located.speed;
 // Prefer frames around the playhead, but never cross a clip boundary;
 // this avoids ghosting at edits and keeps the preview render small.
 const left=clamp(t-at-.35,0,Math.max(0,clipDuration-.20));
 const length=Math.min(2,clipDuration-left);
 if(length<.08)return null;
 const start=located.start+left*located.speed;
 const end=Math.min(located.end,start+length*located.speed);
 return {...located,start,end,at:0,previewSeconds:(end-start)/located.speed};
}
function buildForm(clip){
 const file=bridge().file();
 if(!file)throw Error('Importe um vídeo primeiro.');
 const source=window.VideoEnhancerProjectMedia?.getComposition?.()||{};
 const video=$('player');
 const originalWidth=Number(source.width||video.videoWidth||720);
 const originalHeight=Number(source.height||video.videoHeight||1280);
 if(!(originalWidth>0&&originalHeight>0))throw Error('Resolução do vídeo indisponível.');
 // An intentionally reduced 540p preview avoids excessive CPU/RAM cost
 // while preserving aspect ratio and motion interpolation controls.
 const scale=Math.min(1,540/Math.max(originalWidth,originalHeight));
 const cw=even(originalWidth*scale),ch=even(originalHeight*scale);
 const previewClip={...clip};
 delete previewClip.previewSeconds;
 if(clip.transform){
  previewClip.transform={
   ...clip.transform,x:clip.transform.x*cw/originalWidth,
   y:clip.transform.y*ch/originalHeight,
   width:clip.transform.width*Math.min(cw/originalWidth,ch/originalHeight),
   height:clip.transform.height*Math.min(cw/originalWidth,ch/originalHeight)
  };
 }
 const form=new FormData();form.append('file',file);
 form.append('clips',JSON.stringify([previewClip]));
 form.append('composition',JSON.stringify({width:cw,height:ch,fps:Number(source.fps||bridge().fps())}));
 // Keep the blur and enhancement algorithms identical to final export,
 // but avoid exporting sound or posting the preview to TikTok.
 form.append('quality',$('exportQuality').value);
 form.append('resolution','original');form.append('fps','original');
 form.append('mute','true');
 form.append('export_mode',$('exportMode').value);
 form.append('platform_preset','none');
 for(const [key,id] of [
  ['motion_blur','motionBlur'],['blur_amount','blurAmount'],
  ['blur_mix','blurBlend'],['blur_direction','blurDirection'],
  ['blur_times','blurTimes'],['blur_algorithm','blurAlgorithm']
 ])form.append(key,$(id).value);
 return {form,width:cw,height:ch};
}
async function previewEffects(){
 if(active){hide();return}
 const clip=trimWindow();
 if(!clip){status.textContent='Posicione a linha de reprodução dentro de um clipe.';pane.hidden=false;return}
 let built;
 try{built=buildForm(clip)}catch(e){status.textContent=e.message;pane.hidden=false;return}
 const id=++counter;active=true;button.disabled=true;button.textContent='Preparando prévia…';
 pane.hidden=false;preview.pause();preview.removeAttribute('src');preview.load();
 status.textContent='Renderizando '+fmt(clip.previewSeconds)+' em '+built.width+' × '+built.height+' (sem download)…';
 // Stop source audio when opening the rendered comparison.
 $('player').pause();
 try{
  const job=await responseJson('/api/editor/export',{method:'POST',body:built.form});
  for(let tries=0;tries<240;tries++){
   if(id!==counter)return;
   const result=await responseJson('/api/jobs/'+encodeURIComponent(job.id));
   if(id!==counter)return;
   if(result.status==='error')throw Error(result.error||'Falha ao renderizar a prévia');
   if(result.status==='done'){
    status.textContent='Prévia pronta. Reproduza para conferir o efeito. Volte ao editor para alterar os ajustes.';
    preview.src='/api/editor/preview/'+encodeURIComponent(job.id);
    preview.load();
    preview.play().catch(()=>{});
    return;
   }
   status.textContent='Renderizando '+fmt(clip.previewSeconds)+' · '+(result.progress||0)+'%';
   await new Promise(resolve=>setTimeout(resolve,850));
  }
  throw Error('A prévia demorou mais do que o esperado. Reduza o Motion Blur e tente novamente.');
 }catch(err){
  if(id!==counter)return;
  status.textContent='Erro: '+err.message;
 }finally{
  if(id===counter){active=false;button.disabled=false;button.textContent='◉ Refazer prévia'}
 }
}
button.addEventListener('click',previewEffects);
$('closeEffectPreview').addEventListener('click',hide);
$('importFile').addEventListener('change',hide);
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!pane.hidden)hide()});
})();