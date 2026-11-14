(()=>{
'use strict';
const $=id=>document.getElementById(id);
const stage=$('canvasStage'), target=$('transformTarget'), video=$('player');
const hGuide=$('canvasGuideH'),vGuide=$('canvasGuideV');
const state={width:0,height:0,active:null,snap:true,raf:0,gesture:null,scale:1,angles:0};
const HANDLES=['nw','n','ne','e','se','s','sw','w'];
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const finite=n=>Number.isFinite(n);
function defaultTransform(){return {x:state.width/2,y:state.height/2,width:state.width,height:state.height,rotation:0};}
function ensure(t){let d=defaultTransform();if(!t)return d;for(const k of Object.keys(d))if(finite(Number(t[k])))d[k]=Number(t[k]);d.width=clamp(d.width,8,Math.max(16,state.width*8));d.height=clamp(d.height,8,Math.max(16,state.height*8));return d;}
function dimension(width,height){
 if(!width||!height)return;
 state.width=width;state.height=height;stage.style.aspectRatio=width+'/'+height;
 updateSize();
}
function updateSize(){
 if(!state.width)return;
 const root=$('previewCanvas');const availableWidth=root.clientWidth,availableHeight=root.clientHeight;
 const scale=Math.min(availableWidth/state.width,availableHeight/state.height);
 state.scale=Math.max(.0001,scale);stage.style.width=(state.width*scale)+'px';stage.style.height=(state.height*scale)+'px';schedule();
}
function set(t){state.active=t?ensure(t):null;schedule();}
function bbox(t){
 const a=t.rotation*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));
 return {halfWidth:(t.width*c+t.height*s)/2,halfHeight:(t.width*s+t.height*c)/2};
}
function clearGuides(){hGuide.hidden=true;vGuide.hidden=true;}
function snapAxis(value,size,composition,tolerance){
 const candidates=[{at:composition/2,to:composition/2,name:'center'},{at:size,to:size,name:'near'},{at:composition-size,to:composition-size,name:'far'}];
 let nearest=null;
 for(const candidate of candidates){const dist=Math.abs(value-candidate.to);if(dist<=tolerance&&(!nearest||dist<nearest.dist))nearest={...candidate,dist};}
 return nearest;
}
function magnetize(t,axes='xy'){
 if(!state.snap){clearGuides();return t;}
 const tolerance=8/state.scale,b=bbox(t);
 if(axes.includes('x')){const s=snapAxis(t.x,b.halfWidth,state.width,tolerance);if(s){t.x=s.to;vGuide.hidden=false;vGuide.style.left=(s.name==='near'?0:s.name==='far'?state.width:state.width/2)*state.scale+'px'}else vGuide.hidden=true;}
 if(axes.includes('y')){const s=snapAxis(t.y,b.halfHeight,state.height,tolerance);if(s){t.y=s.to;hGuide.hidden=false;hGuide.style.top=(s.name==='near'?0:s.name==='far'?state.height:state.height/2)*state.scale+'px'}else hGuide.hidden=true;}
 return t;
}
function paint(){
 state.raf=0;if(!state.active||!state.width){target.hidden=true;clearGuides();return}
 target.hidden=false;const t=state.active;
 target.style.width=t.width*state.scale+'px';target.style.height=t.height*state.scale+'px';
 target.style.transform='translate3d('+(t.x*state.scale-t.width*state.scale/2)+'px,'+(t.y*state.scale-t.height*state.scale/2)+'px,0) rotate('+t.rotation+'deg)';
 $('canvasStatus').textContent=Math.round(t.x)+', '+Math.round(t.y)+'  ·  '+Math.round(t.width)+' × '+Math.round(t.height)+'  ·  '+t.rotation.toFixed(1)+'°';
}
function schedule(){if(!state.raf)state.raf=requestAnimationFrame(paint);}
function screenDelta(e,g){return {x:(e.clientX-g.clientX)/state.scale,y:(e.clientY-g.clientY)/state.scale};}
function down(e){
 if(!state.active||e.button>0)return;
 const handle=e.target.closest('[data-handle]')?.dataset.handle||'move';
 const origin={...state.active};state.gesture={pointer:e.pointerId,clientX:e.clientX,clientY:e.clientY,origin,handle};
 target.setPointerCapture(e.pointerId);e.preventDefault();clearGuides();
}
function move(e){
 const g=state.gesture;if(!g||g.pointer!==e.pointerId||!state.active)return;
 const {x,y}=screenDelta(e,g),o=g.origin,t=state.active;
 let axes='xy';
 if(g.handle==='move'){t.x=o.x+x;t.y=o.y+y;}
 else if(g.handle==='rotate'){const rect=stage.getBoundingClientRect();const center={x:rect.left+o.x*state.scale,y:rect.top+o.y*state.scale};const start=Math.atan2(g.clientY-center.y,g.clientX-center.x);t.rotation=o.rotation+(Math.atan2(e.clientY-center.y,e.clientX-center.x)-start)*180/Math.PI;clearGuides();schedule();return;}
 else {
  const h=g.handle;
  const a=o.rotation*Math.PI/180,co=Math.cos(a),si=Math.sin(a);
  const localX=x*co+y*si,localY=-x*si+y*co;
  const signX=h.includes('w')?-1:h.includes('e')?1:0;
  const signY=h.includes('n')?-1:h.includes('s')?1:0;
  const dw=signX*localX,dh=signY*localY;
  t.width=clamp(o.width+dw,8,state.width*8);
  t.height=clamp(o.height+dh,8,state.height*8);
  const actualDx=signX*(t.width-o.width)/2,actualDy=signY*(t.height-o.height)/2;
  t.x=o.x+actualDx*co-actualDy*si;
  t.y=o.y+actualDx*si+actualDy*co;
  axes=signX&&signY?'xy':signX?'x':'y';
 }
 magnetize(t,axes);schedule();
}
function up(e){if(!state.gesture||state.gesture.pointer!==e.pointerId)return;state.gesture=null;clearGuides();schedule();window.dispatchEvent(new CustomEvent('video-enhancer-canvas-change',{detail:{...state.active}}));}
target.addEventListener('pointerdown',down);
target.addEventListener('pointermove',move);
target.addEventListener('pointerup',up);
target.addEventListener('pointercancel',up);
for(const position of HANDLES){const el=document.createElement('div');el.className='canvas-handle handle-'+position;el.dataset.handle=position;el.title='Redimensionar '+position;target.appendChild(el);}
const rot=document.createElement('div');rot.className='canvas-rotate';rot.dataset.handle='rotate';rot.title='Girar';rot.textContent='⟳';target.appendChild(rot);
$('canvasSnap').addEventListener('change',e=>{state.snap=e.target.checked;clearGuides()});
$('alignX').addEventListener('click',()=>align('x'));
$('alignY').addEventListener('click',()=>align('y'));
$('alignBoth').addEventListener('click',()=>align('xy'));
$('resetTransform').addEventListener('click',()=>{if(!state.active)return;Object.assign(state.active,defaultTransform());schedule();announce()});
function announce(){window.dispatchEvent(new CustomEvent('video-enhancer-canvas-change',{detail:{...state.active}}));}
function align(axis){if(!state.active)return;if(axis.includes('x'))state.active.x=state.width/2;if(axis.includes('y'))state.active.y=state.height/2;clearGuides();schedule();announce();}
function get(){return state.active?{...state.active}:defaultTransform();}
const resize=new ResizeObserver(updateSize);resize.observe($('previewCanvas'));
window.VideoEnhancerCanvas={dimension,set,get,ensure,align,updateSize};
})();