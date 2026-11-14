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


## Editor de vídeo (V1.1)
Abra **http://127.0.0.1:8000/editor** para editar um vídeo com uma timeline.

- Importar um vídeo, reproduzir e navegar na timeline
- Dividir trechos (tecla S), aparar início/fim arrastando as bordas, modificar tempos e velocidade
- Duplicar, excluir, reordenar trechos e desfazer alterações (Ctrl+Z)
- Exportar para MP4 com corte, velocidade, áudio opcional, resolução, melhoria e 60 FPS

**Limites atuais:** só um arquivo de mídia por projeto, sem trilhas de música, texto, stickers, transições ou efeitos avançados. O editor usa um único vídeo original para todos os segmentos. A prévia usa o player HTML5 e pode não suportar alguns formatos que o FFmpeg aceita. A exportação requer FFmpeg e o servidor local ativo. Ainda não há salvamento persistente de projetos.

### Atualização da timeline (V1.2)
- Prévia limitada à área do player: vídeo vertical ou quadrado não cobre mais a timeline
- Miniaturas visuais na linha do tempo (quando o navegador consegue decodificar o arquivo)
- Undo/redo, ajuste por bordas com encaixe, navegação quadro a quadro com as setas
- Exportação preserva a taxa de quadros de origem (até 60 FPS) quando o modo 60 FPS está desligado

Atualize com `git pull` e **reinicie** `python app.py`. Force o recarregamento do editor com Ctrl+F5.

### Projetos de edição
No editor, use **Salvar projeto** para baixar um arquivo `.veproj.json` com cortes, ordem, velocidades e configurações. Use **Abrir projeto** para restaurar o JSON. Por motivos de privacidade e tamanho, o arquivo JSON **não contém o vídeo**: após abrir, selecione também o mesmo arquivo original. O programa compara nome e tamanho para evitar aplicar cortes sobre outro vídeo.

**Limitações da V1.2:** a timeline ainda tem apenas uma faixa de vídeo e uma mídia de origem por projeto. Não há trilhas de texto, áudio independente, efeitos animados, chroma key ou múltiplos arquivos na mesma montagem. Não considere esses recursos implementados. O player reproduz cortes no navegador; a exportação final usa FFmpeg e pode diferir ligeiramente da prévia.
