# Video Enhancer

Aplicação web local para melhorar vídeos e converter a taxa de quadros com FFmpeg. Gratuita, sem upload para servidores externos.

## Recursos da V1
- Arrastar ou selecionar vídeo pelo navegador
- Redução de ruído, nitidez e correção moderada de contraste
- Escalonamento para 720p, 1080p ou 4K (não recria detalhes que não existem)
- Interpolação por movimento para até 60 FPS com filtro `minterpolate` (não apenas duplicação)
- Acompanhar progresso, visualizar original e resultado, baixar MP4
- Processamento em segundo plano no computador que hospeda o site

**Nota:** esta versão usa processamento FFmpeg, **não** Real-ESRGAN ou RIFE. A opção “Melhoria forte” ajusta filtros convencionais; não é upscaling por IA. O resultado depende do material original e pode gerar artefatos.

## Windows: instalação

1. Instale [Python 3.11+](https://www.python.org/downloads/) e [FFmpeg](https://ffmpeg.org/download.html), com `ffmpeg` e `ffprobe` no PATH.
2. Clone este repositório:
   ```powershell
   git clone https://github.com/raphaelsancho21-byte/Video-Enhancer.git
   cd Video-Enhancer
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   python app.py
   ```
3. Abra **http://127.0.0.1:8000**.

Se o PowerShell bloquear a ativação da venv, use `.venv\Scripts\python.exe -m pip install -r requirements.txt` e `.venv\Scripts\python.exe app.py`.

## Comportamento e limitações

- O servidor aceita arquivos de vídeo de até 1 GB; para proteger RAM, salva o upload em partes no disco.
- Saídas ficam em `data/outputs/`; arquivos temporários e vídeos originais em `data/uploads/`. Limpe essas pastas após o uso.
- Por padrão, suporta **uma tarefa de cada vez**; pode acompanhar a fila na interface.
- Interpolação óptica e upscale 4K são pesados, principalmente sem GPU: teste primeiro vídeos curtos.
- Não publique diretamente este backend na internet sem adicionar autenticação, limites de uso e isolamento.
- GitHub Pages consegue hospedar só os arquivos estáticos; este backend requer um PC ou servidor Python ativo.

## Estrutura
```
app.py                  # API e processamento FFmpeg
static/index.html       # site
static/styles.css       # visual
static/app.js           # lógica da UI
requirements.txt
.github/workflows/check.yml
```

## Desenvolvimento
Execute `python -m compileall -q app.py` para conferir a sintaxe Python. Projeto MIT.
