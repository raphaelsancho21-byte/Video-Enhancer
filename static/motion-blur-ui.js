(()=>{
'use strict';
const $=id=>document.getElementById(id);
const control=$('motionBlur'),amount=$('blurAmount'),mix=$('blurBlend'),
 direction=$('blurDirection'),times=$('blurTimes');
const framesFor=(v,t)=>Math.max(2,Math.min(16,2+Math.round((v/100)*(2+2*t))));
function refresh(){
 $('blurAmountValue').textContent=amount.value;
 $('blurBlendValue').textContent=mix.value;
 const enabled=control.value!=='off';
 $('motionControls').classList.toggle('is-off',!enabled);
 const frameCount=framesFor(Number(amount.value),Number(times.value));
 $('motionFramesInfo').textContent=enabled
  ? frameCount+' quadros · '+(direction.value==='both'?'2 direções':direction.value==='backward'?'passado':'futuro')
  : 'Desligado';
}
function custom(){control.value='custom';refresh()}
for(const field of [amount,mix,direction,times]){
 field.addEventListener('input',custom);
 field.addEventListener('change',custom);
}
control.addEventListener('change',()=>{
 const legacy={light:[28,45,'backward',1],medium:[55,65,'backward',2],strong:[88,90,'both',4]};
 if(legacy[control.value]){
  const [a,m,d,t]=legacy[control.value];amount.value=a;mix.value=m;direction.value=d;times.value=String(t);
  control.value='custom';
 }
 refresh();
});
window.VideoEnhancerMotionBlur={refresh};
refresh();
})();