(() => {
'use strict';
const $ = id => document.getElementById(id);
let connected=false, configured=false, lastExport=null, busy=false;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function json(url,opts){
 const r=await fetch(url,opts);
 const payload=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(payload.detail||('HTTP '+r.status));
 return payload;
}
function display(message){$('tiktokStatus').textContent=message;}
function update(){
 $('tiktokConnect').hidden=connected;
 $('tiktokDisconnect').hidden=!connected;
 $('tiktokShare').disabled=!connected||!lastExport||busy;
}
async function status(){
 try{
  const result=await json('/api/tiktok/status');
  configured=result.configured;connected=result.connected;
  display(!configured?'É necessário configurar o aplicativo no TikTok for Developers.':
   connected?'Conta TikTok conectada. Envio para rascunhos disponível.':
   'Conta desconectada. Clique em Conectar TikTok.');
  update();
 }catch(e){display('Não foi possível consultar a conexão: '+e.message);}
}
$('platformPreset').addEventListener('change',()=>{
 if($('platformPreset').value!=='tiktok_hq')return;
 const preset=$('compositionPreset');
 preset.value='1080x1920';
 preset.dispatchEvent(new Event('change'));
 $('exportResolution').value='original';
 $('exportFps').value='original';
 $('exportQuality').value='balanced';
 $('exportMode').value='fast';
 $('projectFps').value='30';
 $('projectFps').dispatchEvent(new Event('change'));
 display(connected?'TikTok HQ ativado. Conta conectada.':'TikTok HQ ativado. Conecte sua conta para enviar rascunhos.');
});
$('tiktokConnect').addEventListener('click',()=>{
 if(!configured){
  display('Configure TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET no PC. Consulte as instruções no README.');
  return;
 }
 window.location.assign('/api/tiktok/connect');
});
$('tiktokDisconnect').addEventListener('click',async()=>{
 try{await json('/api/tiktok/disconnect',{method:'POST'});connected=false;await status();}
 catch(e){display('Falha ao desconectar: '+e.message);}
});
window.addEventListener('video-enhancer-exported',event=>{
 lastExport=event.detail?.jobId||null;
 update();
 if(lastExport&&connected)display('Vídeo pronto. Clique em Enviar vídeo ao TikTok quando quiser.');
});
$('tiktokShare').addEventListener('click',async()=>{
 if(!lastExport||!connected||busy)return;
 // This click is the user's explicit consent to transfer the exported video.
 busy=true;update();
 try{
  display('Enviando para a caixa de entrada do TikTok...');
  const task=await json('/api/tiktok/share/'+encodeURIComponent(lastExport),{method:'POST'});
  for(let attempts=0;attempts<360;attempts++){
   await delay(1300);
   const progress=await json('/api/tiktok/share/status/'+encodeURIComponent(task.id));
   $('tiktokProgress').textContent=progress.stage+' · '+(progress.progress||0)+'%';
   if(progress.status==='error')throw Error(progress.error||'Falha no envio');
   if(progress.status==='done'){
    display('Vídeo enviado! Abra a notificação no aplicativo TikTok para concluir a publicação.');
    break;
   }
  }
 }catch(e){display('Não foi possível enviar: '+e.message)}
 finally{busy=false;update()}
});
const params=new URLSearchParams(window.location.search);
if(params.get('tiktok')==='connected')display('Autorização recebida. Conferindo permissões...');
if(params.get('tiktok')==='denied')display('Conexão TikTok cancelada.');
status();
})();