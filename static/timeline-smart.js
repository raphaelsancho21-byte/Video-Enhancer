(()=>{
'use strict';
const $=id=>document.getElementById(id),round=(v,f=30)=>Math.round(v*f)/f,clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const S={magnet:true,beatSnap:true,ripple:true,beats:[],manual:[],waveform:[],analyzed:null,music:null,raf:0,drag:null};
let B;
const get=()=>window.VideoEnhancerTimelineBridge;
const frames=()=>Number(get()?.fps?.()||30);
const px=()=>Number($('zoom').value);
const time=(clip)=>clip.at||0, duration=(clip)=>(clip.end-clip.start)/clip.speed;
function findNeighbors(index){
 const all=get().clips();const c=all[index];const items=all.map((x,i)=>({i,start:time(x),end:time(x)+duration(x)})).filter(x=>x.i!==index).sort((a,b)=>a.start-b.start);
 let prev=null,next=null;
 for(const item of items){if(item.start<=time(c))prev=item;else{next=item;break}}
 return {prev,next};
}
function candidates(exclude){
 const list=[];if(S.magnet){for(const [i,c] of get().clips().entries()){if(i===exclude)continue;list.push(time(c),time(c)+duration(c))}list.push(0,get().cursor())}
 if(S.beatSnap)list.push(...S.beats,...S.manual);
 return list;
}
function snap(value,exclude,edge='start'){
 const tolerance=10/px();let nearest=null;
 for(const v of candidates(exclude)){const d=Math.abs(v-value);if(d<=tolerance&&(!nearest||d<nearest.dist))nearest={value:v,dist:d}}
 const result=nearest?round(nearest.value,frames()):round(value,frames());
 const guide=$('snapGuide');guide.hidden=!nearest;
 if(nearest)guide.style.left=(90+result*px())+'px';
 return result;
}
function clearGuide(){$('snapGuide').hidden=true;}
function shiftAfter(index,oldEnd,newEnd){
 const clips=get().clips();const delta=newEnd-oldEnd;if(delta<=0)return;
 // A ripple pushes only following clips; collisions are resolved in forward order.
 const sorted=clips.map((c,i)=>({c,i})).filter(x=>x.i!==index&&time(x.c)>=oldEnd-1/frames()).sort((a,b)=>time(a.c)-time(b.c));
 let minEnd=newEnd;
 for(const {c} of sorted){c.at=round(Math.max(time(c)+delta,minEnd),frames());minEnd=c.at+duration(c)}
}
function clampPosition(index,requested){
 const clips=get().clips(),c=clips[index],len=duration(c),initial=time(c);
 const ordered=clips.map((other,i)=>({i,start:time(other),end:time(other)+duration(other)})).filter(x=>x.i!==index).sort((a,b)=>a.start-b.start);
 let prev=null,next=null;
 for(const other of ordered){if(other.end<=initial+1/frames())prev=other;else if(other.start>=initial-1/frames()){next=other;break}}
 const min=prev?prev.end:0,max=(!S.ripple&&next)?next.start-len:Infinity;
 return clamp(snap(Math.max(0,requested),index),min,Math.max(min,max));
}
function beginMove(e,index,element){
 if(e.button!==0||e.target.closest('.trim'))return;
 const clips=get().clips(),c=clips[index];if(!c)return;
 e.preventDefault();e.stopPropagation();
 get().select(index);
 const start={at:time(c),positions:clips.map(x=>time(x)),client:e.clientX};get().snapshot();
 const gesture={pointer:e.pointerId,index,element,start,client:e.clientX,mode:'move'};
 S.drag=gesture;element.setPointerCapture(e.pointerId);
}
function beginTrim(e,index,side,element){
 if(e.button!==0)return;
 const c=get().clips()[index];if(!c)return;
 e.preventDefault();e.stopPropagation();
 get().select(index);get().snapshot();
 S.drag={pointer:e.pointerId,index,element,client:e.clientX,mode:side,source:{...c},positions:get().clips().map(x=>time(x))};
 element.setPointerCapture(e.pointerId);
}
function onMove(e){
 const g=S.drag;if(!g||g.pointer!==e.pointerId)return;
 g.latestX=e.clientX;if(S.raf)return;S.raf=requestAnimationFrame(()=>{
  S.raf=0;if(!S.drag||!g.latestX)return;
  const c=get().clips()[g.index],dt=(g.latestX-g.client)/px(),frame=frames();
  // Restore original positions for deterministic movement independent of frame rate.
  get().clips().forEach((clip,i)=>clip.at=g.positions?g.positions[i]:g.start.positions[i]);
  if(g.mode==='move'){
    let value=clampPosition(g.index,g.start.at+dt);
    c.at=round(value,frame);
    if(S.ripple)shiftAfter(g.index,g.start.at+duration(c),c.at+duration(c));
  }else{
    const origin=g.source,oldLen=duration(origin),d=Math.round(dt*frame)/frame;
    if(g.mode==='left'){
      const right=time(origin)+oldLen;
      const prev=get().clips().filter(x=>x!==c&&time(x)+duration(x)<=time(origin)+1/frame).sort((a,b)=>time(b)-time(a))[0];
      let beginning=snap(time(origin)+d,g.index);
      beginning=Math.min(right-1/frame,Math.max(prev?time(prev)+duration(prev):0,beginning));
      const sourceDelta=(beginning-time(origin))*origin.speed;
      c.start=clamp(origin.start+sourceDelta,0,origin.end-.08);
      c.at=round(right-duration(c),frame);
    }else{
      const oldEnd=time(origin)+oldLen;
      let desired=snap(oldEnd+d,g.index,'end');
      if(!S.ripple){
        const next=get().clips().filter(x=>x!==c&&time(x)>=oldEnd-1/frame).sort((a,b)=>time(a)-time(b))[0];
        if(next)desired=Math.min(desired,time(next));
      }
      c.end=clamp(origin.end+(desired-oldEnd)*origin.speed,origin.start+.08,get().sourceDuration());
      if(S.ripple)shiftAfter(g.index,oldEnd,time(c)+duration(c));
    }
  }
  for(const [i,clip] of get().clips().entries()){
    const node=$('clips').querySelector('[data-index="'+i+'"]');
    if(node){node.style.left=(time(clip)*px())+'px';node.style.width=Math.max(4,duration(clip)*px())+'px'}
  }
 });
}
function finish(e){
 if(!S.drag||e.pointerId!==S.drag.pointer)return;
 const gesture=S.drag;
 // Let the pending animation frame apply exactly the last pointer position,
 // then rebuild DOM only once at gesture end.
 if(S.raf){cancelAnimationFrame(S.raf);S.raf=0}
 S.drag=null;clearGuide();
 const c=get().clips()[gesture.index];
 if(gesture.mode==='move'){
   const dt=(e.clientX-gesture.client)/px();
   get().clips().forEach((clip,i)=>clip.at=gesture.start.positions[i]);
   c.at=clampPosition(gesture.index,gesture.start.at+dt);
   if(S.ripple)shiftAfter(gesture.index,gesture.start.at+duration(c),c.at+duration(c));
 }
 get().seek(Math.min(get().cursor(),get().total()));get().render();
}
function bindClip(element,index){
 element.addEventListener('pointerdown',e=>{
  const h=e.target.closest('.trim');
  if(h)beginTrim(e,index,h.classList.contains('left')?'left':'right',element);
  else beginMove(e,index,element);
 });
 element.addEventListener('pointermove',onMove);
 element.addEventListener('pointerup',finish);
 element.addEventListener('pointercancel',finish);
}
function normalize(index,oldEnd){
 const clips=get().clips(),c=clips[index];if(!c)return;
 const before=Number.isFinite(oldEnd)?oldEnd:time(c)+duration(c);
 const other=clips.map((x,i)=>({i,start:time(x),end:time(x)+duration(x)})).filter(x=>x.i!==index).sort((a,b)=>a.start-b.start);
 let pos=0;for(const o of other){if(o.start>=time(c))break;pos=Math.max(pos,o.end)}
 c.at=Math.max(time(c),pos);
 if(S.ripple)shiftAfter(index,before,c.at+duration(c));
 else {const next=other.find(x=>x.start>=c.at);if(next&&c.at+duration(c)>next.start)c.end=c.start+(next.start-c.at)*c.speed}
}
function insertAfter(index){
 const clips=get().clips(),c=clips[index];let next=time(c)+duration(c);
 for(const item of clips.filter(x=>x!==c&&time(x)>=next-1/frames())){item.at=round(time(item)+duration(c),frames())}
 return round(next,frames());
}
function deleteAt(index,oldStart,oldLength){
 if(!S.ripple)return;
 for(const c of get().clips()){if(time(c)>=oldStart+oldLength-1/frames())c.at=round(Math.max(oldStart,time(c)-oldLength),frames())}
}
function visualize(){
 const data=get();if(!data)return;
 const p=px(),length=data.total();
 const canvas=$('waveformCanvas'),width=Math.max(1,Math.min(2048,Math.ceil(length*p))),height=34;
 if(canvas.width!==width)canvas.width=width;
 canvas.style.width=(length*p)+'px';
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,width,height);
 const samples=S.waveform;if(samples.length){
  const scaleX=width/Math.max(1,length);
  ctx.fillStyle='rgba(103,141,242,.65)';
  for(let i=0;i<samples.length;i++){
   const t=i/S.waveform.length*S.analyzed.duration,x=Math.round(t*scaleX);
   if(x>=width)break;
   const h=Math.min(16,samples[i]*34);ctx.fillRect(x,17-h,1,h*2);
  }
 }
 ctx.fillStyle='#ffab3b';
 for(const t of S.beats){const x=Math.round(t*p*width/Math.max(1,length*p));if(x>=0&&x<width)ctx.fillRect(x,0,1,height)}
 const layer=$('manualMarkers');layer.replaceChildren();
 S.manual.slice(0,200).forEach((t,i)=>{
  const marker=document.createElement('div');marker.className='beat-marker';marker.style.left=(t*p)+'px';marker.title='Arraste para mover • duplo clique para excluir';
  marker.addEventListener('dblclick',e=>{e.stopPropagation();S.manual.splice(i,1);visualize()});
  marker.addEventListener('pointerdown',e=>{
   e.preventDefault();e.stopPropagation();marker.setPointerCapture(e.pointerId);const ox=e.clientX,ot=t;
   const move=event=>{S.manual[i]=round(Math.max(0,ot+(event.clientX-ox)/p),frames());marker.style.left=(S.manual[i]*p)+'px'};
   const up=()=>{marker.removeEventListener('pointermove',move);marker.removeEventListener('pointerup',up);marker.removeEventListener('pointercancel',up);visualize()};
   marker.addEventListener('pointermove',move);marker.addEventListener('pointerup',up);marker.addEventListener('pointercancel',up);
  });
  layer.appendChild(marker);
 });
}
function toggle(button,field){const el=$(button);el.classList.toggle('on',S[field]);el.setAttribute('aria-pressed',String(S[field]));el.addEventListener('click',()=>{S[field]=!S[field];el.classList.toggle('on',S[field]);el.setAttribute('aria-pressed',String(S[field]))})}
toggle('magnetToggle','magnet');toggle('beatToggle','beatSnap');toggle('rippleToggle','ripple');
$('beatFile').addEventListener('change',e=>{S.music=e.target.files[0]||null;$('beatInfo').textContent=S.music?'Música selecionada: '+S.music.name:'';$('detectBeats').disabled=!(S.music||get()?.file())});
$('detectBeats').addEventListener('click',async()=>{
 const file=S.music||get()?.file();if(!file)return;
 $('detectBeats').disabled=true;$('beatInfo').textContent='Analisando batidas (sem usar RAM para o vídeo inteiro)...';
 try{
  const form=new FormData();form.append('file',file);
  const response=await fetch('/api/editor/beats',{method:'POST',body:form});
  const info=await response.json();if(!response.ok)throw Error(info.detail||'Falha na análise');
  S.beats=info.beats||[];S.waveform=info.waveform||[];S.analyzed={duration:info.duration};
  $('beatInfo').textContent=S.beats.length+' batidas encontradas. Duplo clique em marcadores manuais para excluir.';
  visualize();
 }catch(e){$('beatInfo').textContent='Falha: '+e.message}
 finally{$('detectBeats').disabled=false}
});
$('addBeatMarker').addEventListener('click',()=>{S.manual.push(round(get().cursor(),frames()));S.manual.sort((a,b)=>a-b);visualize()});
window.TimelineSmart={bindClip,snap,normalize,insertAfter,deleteAt,visualize,clearGuide,get ripple(){return S.ripple},get manual(){return S.manual},loadMarkers(value){S.manual=Array.isArray(value)?value.filter(Number.isFinite).slice(0,200):[];visualize()},get detected(){return S.beats},ready(){visualize();$('detectBeats').disabled=!get()?.file()}};
})();