const $ = (id) => document.getElementById(id);
const input = $('videoInput');
const dropzone = $('dropzone');
const fileCard = $('fileCard');
const processBtn = $('processBtn');
const message = $('message');
let file = null;
let originalUrl = null;
let resultUrl = null;
let running = false;
const formatSize = (bytes) => bytes < 1048576 ? (bytes / 1024).toFixed(0) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';
function setFile(next) {
  if (running) return;
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  file = next || null;
  $('resultArea').hidden = true;
  $('progressArea').hidden = true;
  $('resultPreview').removeAttribute('src');
  $('resultPreview').load();
  if (!file) {
    dropzone.hidden = false;
    fileCard.hidden = true;
    input.value = '';
    processBtn.disabled = true;
    message.textContent = 'Selecione um vídeo para começar.';
    return;
  }
  if (file.size > 1024 * 1024 * 1024) {
    setFile(null);
    message.textContent = 'Arquivo maior que 1 GB. Escolha um vídeo menor.';
    return;
  }
  originalUrl = URL.createObjectURL(file);
  $('preview').src = originalUrl;
  $('fileName').textContent = file.name;
  $('fileDetail').textContent = formatSize(file.size);
  dropzone.hidden = true;
  fileCard.hidden = false;
  processBtn.disabled = false;
  message.textContent = 'Vídeo pronto para processar.';
}
input.addEventListener('change', () => setFile(input.files?.[0]));
$('removeFile').addEventListener('click', () => setFile(null));
dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
for (const type of ['dragenter','dragover']) dropzone.addEventListener(type, (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
for (const type of ['dragleave','drop']) dropzone.addEventListener(type, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); });
dropzone.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) setFile(e.dataTransfer.files[0]); });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function getJSON(url, options) {
  const response = await fetch(url, options);
  let body;
  try { body = await response.json(); } catch { throw new Error('Resposta inesperada do servidor'); }
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Falha na solicitação');
  return body;
}
processBtn.addEventListener('click', async () => {
  if (!file || running) return;
  running = true;
  processBtn.disabled = true;
  $('removeFile').disabled = true;
  for (const id of ['quality','resolution','fps']) $(id).disabled = true;
  $('progressArea').hidden = false;
  $('resultArea').hidden = true;
  $('progressBar').style.width = '0%';
  $('percentage').textContent = '0%';
  $('stage').textContent = 'Enviando vídeo...';
  message.textContent = 'Mantenha esta aba aberta até o processamento terminar.';
  try {
    const form = new FormData();
    form.append('file', file);
    for (const id of ['quality','resolution','fps']) form.append(id, $(id).value);
    const { id } = await getJSON('/api/jobs', { method: 'POST', body: form });
    let job;
    do {
      job = await getJSON('/api/jobs/' + encodeURIComponent(id));
      $('stage').textContent = job.stage || 'Processando';
      $('percentage').textContent = (job.progress || 0) + '%';
      $('progressBar').style.width = (job.progress || 0) + '%';
      if (job.status === 'error') throw new Error(job.error || 'Erro no processamento');
      if (job.status !== 'done') await sleep(1100);
    } while (job.status !== 'done');
    const href = job.download;
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    $('resultPreview').src = href;
    $('downloadBtn').href = href;
    $('resultArea').hidden = false;
    message.textContent = 'Concluído! Você pode assistir e baixar o resultado.';
  } catch (error) {
    $('stage').textContent = 'Não foi possível concluir';
    message.textContent = error.message || String(error);
  } finally {
    running = false;
    processBtn.disabled = !file;
    $('removeFile').disabled = false;
    for (const id of ['quality','resolution','fps']) $(id).disabled = false;
  }
});