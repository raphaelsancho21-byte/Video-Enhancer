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


## Smart Timeline & Canvas Snapping (V1.3)

Abra o editor em `http://127.0.0.1:8000/editor`.

### Canvas Smart Snapping & Alignment
- Clique ou toque no vídeo para mover, redimensione pelas 8 alças e use o controle ⟳ para girar.
- **Smart Snapping** aproxima automaticamente centros X/Y e as quatro bordas da composição. A tolerância equivale a aproximadamente 8 pixels na tela.
- Botões **Centro X**, **Centro Y** e **Centralizar** fazem alinhamento matemático exato.
- A caixa usa coordenadas reais da composição, e não pixels CSS. Dimensões, posições e rotação são salvas para cada trecho e enviadas para o filtro de exportação FFmpeg.
- As guias desaparecem ao soltar. Há suporte a `PointerEvent` (mouse e toque).

### Smart Clip Collision, Ripple e Beat Snapping
- **Magnet** aproxima cortes a bordas de outros clipes e ao cursor, com tolerância visual de 10 px e quantização temporal de frames.
- Arraste os clipes pela timeline; a mesma faixa evita sobreposição, com opção **Ripple** para deslocar clipes posteriores.
- **Beat Snap** alinha início e fim de trechos aos marcadores quando possível, respeitando a colisão na faixa.
- **Carregar música** seleciona uma trilha apenas para análise de batidas; **Detectar batidas** usa FFmpeg em blocos pequenos (análise sob demanda).
- A waveform e os marcadores aparecem na timeline. **+ Marcador** adiciona um marcador manual na posição atual; arraste para mover ou dê duplo clique para excluir.
- No projeto JSON são armazenados os cortes, posições, transformações, preferências de snapping e marcadores manuais.

### Limites atuais
- A timeline editável e exportável ainda tem **uma única faixa de vídeo**. A sobreposição entre faixas diferentes, composição multicamadas e exportação de músicas externas **ainda não estão implementadas**.
- O áudio original permanece unido aos trechos de vídeo, com silêncio nos espaços vazios; o arquivo de música separado é usado somente para a detecção.
- A correspondência prévia/exportação depende da renderização por navegador e FFmpeg; rotação, interpolação e arredondamento de pixels podem produzir diferenças subpixel.
- Para pouca RAM, use vídeos curtos e evite interpolação 60 FPS com upscale 4K simultâneo.
- Teste com `python tests/test_smoke.py` (requer dependências Python e FFmpeg).


## TikTok HQ + conexão de conta (V1.5)

No editor, selecione **Preset para plataforma → TikTok HQ · 9:16**. Isso define composição 1080×1920, H.264/AAC, CRF 19 com bitrate máximo de 10 Mb/s para vídeo normal e 16 Mb/s para o modo 60 FPS, com `+faststart`. Este preset **não impede a recompressão do TikTok** e não garante a mesma qualidade após publicação.

### Conexão oficial (PC local)

1. Registre um aplicativo no [TikTok for Developers](https://developers.tiktok.com/).
2. Ative o **Login Kit** para **Desktop** e **Content Posting API**; solicite aprovação do escopo `video.upload` além de `user.info.basic`. A permissão pode depender de análise/aprovação do TikTok.
3. Registre a URL de retorno **exatamente** como `http://127.0.0.1:8000/api/tiktok/callback` nas configurações de Login Kit para Desktop.
4. No PowerShell, na pasta do projeto, defina as variáveis de ambiente **somente na sessão local**:
   
   ```powershell
   $env:TIKTOK_CLIENT_KEY="SUA_CLIENT_KEY"
   $env:TIKTOK_CLIENT_SECRET="SEU_CLIENT_SECRET"
   python app.py
   ```
   
   **Não adicione a chave secreta ao GitHub nem envie para o chat.**
5. No editor, clique **Conectar TikTok**. Você será redirecionado para a tela de autorização oficial do TikTok; o login utiliza `state` anti-CSRF e PKCE S256 (hex).
6. Exporte o vídeo normalmente. Quando terminar, clique **Enviar vídeo ao TikTok** e acompanhe o progresso.
7. O arquivo vai para os **rascunhos / caixa de entrada** do TikTok por meio da Content Posting API com `video.upload`. Abra a notificação no aplicativo TikTok para concluir a publicação. O Video Enhancer **não publica automaticamente no perfil público**.

### Privacidade e limitações

- **Nunca digite sua senha do TikTok no Video Enhancer.** A autorização é feita no site oficial do TikTok.
- O client secret deve ficar no servidor local. Tokens de acesso/renovação ficam **somente na memória do processo Python**, desaparecem ao reiniciar e não são escritos no projeto ou nos logs.
- Para produção hospedada ou APK Android, é necessário migrar/adaptar o fluxo de OAuth e armazenamento seguro. A rota atual foi desenvolvida **apenas para o programa rodando em 127.0.0.1:8000 no PC**; não exponha o servidor à Internet.
- O TikTok pode limitar o uso da Content Posting API a apps aprovados e restringir uploads. O usuário precisa consentir explicitamente com o envio.
- Enviar um rascunho não é o mesmo que publicar o vídeo. Postagem direta ao perfil exige `video.publish`, consulta de Creator Info, confirmação de privacidade e revisão adicional da aplicação.
- Uma configuração sem Client Key/Secret permite exportar TikTok HQ normalmente, mas o botão de conexão informa que é necessária a integração oficial.
- O tamanho e a duração máximos do envio também dependem dos limites oficiais da API e da conta.


## Motion Blur (V1.6)

O editor agora oferece **Motion Blur** na área de exportação, em quatro níveis: desligado, suave (2 quadros), médio (3 quadros) e intenso (5 quadros). O processamento é feito pelo FFmpeg usando `tmix` **por trecho**, evitando misturar quadros entre cortes diferentes. A configuração é salva no projeto JSON.

Este é um efeito de acumulação temporal de quadros (*frame blending*): cria rastros/ghosting controlados em objetos que se movem, mas **não** é motion blur vetorial com estimativa de movimento. A prévia no navegador continua mostrando os quadros originais; veja o resultado no arquivo exportado. Quanto maior a intensidade, maior o processamento e o risco de imagens fantasma, especialmente com movimento rápido e baixa taxa de quadros. Para TikTok, comece em **Suave** e compare com **Desligado**.


## Motion Blur PRO (V1.7)

Inspirado na interface de ajuste do CapCut, com controles:

- **Desfocar (0–100)**: aumenta a quantidade de frames incluídos na janela temporal, prolongando os rastros.
- **Misturar (0–100)**: interpola de imagem original (0) a rastro temporal completo (100).
- **Direção**: **Retroceder** (frames anteriores), **Encaminhar** (frames seguintes) ou **Ambos** (mistura temporal simétrica).
- **Vezes**: **Uma vez, 2, 4 ou 6 vezes**: amplia a janela de amostragem temporal. É uma aproximação eficiente do controle de processamento do CapCut, e **não significa reprocessar o vídeo 6 vezes**. O limite de segurança é 16 frames retidos por direção.

O filtro FFmpeg executa uma combinação temporal de quadros com `tmix`, `blend`, `setpts` e `tpad` em cada trecho isolado (sem ghosting de um corte no próximo). A direção futura usa ajuste de timestamps, evitando o filtro `reverse`, que armazenaria todo o trecho na memória. Esse efeito **não é motion blur por vetores de movimento** e não será idêntico ao algoritmo do CapCut. A prévia de vídeo permanece original; o efeito aparece ao exportar.

**Custo**: para 1080p, comece com Desfocar 55, Misturar 65, Ambos e 2 vezes. O máximo (100/100, Ambos, 6 vezes) pode exigir mais RAM e tempo para exportar, principalmente em 4K.


### Motion Blur com estimativa de movimento (V1.8)

**Novo padrão:** Fluxo de movimento, opção acima dos controles de Desfocar/Misturar. O motor usa o filtro FFmpeg `minterpolate` em modo `mci` (compensação de movimento), gera até 4 subframes por quadro e acumula uma exposição curta com `tmix` antes de retornar à taxa FPS da composição. Mantém a mistura antiga em uma opção separada. Esse método evita os rastros mais óbvios de cópias de frames, mas não replica o algoritmo proprietário do CapCut, pode introduzir artefatos em oclusões/cortes rápidos e custa muito mais CPU. O efeito é aplicado separadamente a cada clipe. A prévia continua sem esse efeito.


## Importar música MP3 na timeline (A1)

No editor principal (`/editor`), importe primeiro seu vídeo e clique em **Importar MP3 para a timeline** na biblioteca lateral. O MP3 entra diretamente na faixa A1, pode ser movido para ajustar o começo da música, mutado e ter o volume controlado. Clique em **Detectar batidas** para analisar as batidas desse MP3; o arquivo é incluído no vídeo exportado automaticamente, sem baixar nem converter a música antes de editar.

O MP3 é copiado para o armazenamento local do servidor em `data/audio/` (máximo de 256 MB por arquivo). O projeto JSON armazena a referência a esse áudio, não embute o arquivo. Caso mova o projeto para outro PC, é preciso levar a mídia junto. Atualmente existe uma única faixa de áudio A1 no editor principal, e a exportação usa a música da faixa A1 no lugar do áudio original do vídeo (não mistura os dois). O áudio que excede a duração do vídeo é cortado no final da exportação.

A opção separada **Analisar batidas de outro arquivo** apenas analisa música sem adicioná-la à timeline.


## Áudio separado V1/A1 e marcador manual M (V1.10)

- Marque **Remover som original do vídeo (V1)** para silenciar o áudio da gravação, preservando a música MP3 importada na faixa A1. Isso funciona tanto na reprodução quanto na exportação.
- A faixa **A1** continua tendo mute próprio. Se nenhuma das faixas estiver mutada, o FFmpeg mistura V1 + A1 no resultado. **Sem nenhum áudio na exportação** silencia ambas.
- Pressione **M** com o editor em foco, mesmo durante a reprodução, para adicionar imediatamente um marcador na posição exata da timeline (quantizada ao FPS da composição). O botão **＋ Marcador (M)** faz o mesmo. Os marcadores podem ser arrastados e removidos com duplo clique. Ao digitar em campos de texto, o atalho é ignorado.
- Marcadores automáticos e visualização da forma de onda passam a seguir o deslocamento da música MP3 quando ela é arrastada na faixa A1. A reprodução sincroniza a faixa externa com a timeline mais frequentemente para reduzir o desvio percebido.

Se as batidas automáticas ainda estiverem erradas para alguma música, prefira gravar marcadores manuais com M enquanto ouve; a precisão da análise automática varia com ritmo e gênero musical.


## Editor multicamadas — layout desktop V2

O editor principal (`http://127.0.0.1:8000/editor`) agora possui uma área de trabalho mais próxima da organização do CapCut Desktop: biblioteca à esquerda, monitor de vídeo ao centro, ajustes à direita e timeline maior na parte inferior. A navegação superior leva às seções **Mídia**, **Áudio** e **Efeitos** que já existem. Texto e Transições são identificados como recursos ainda não implementados.

### Adicionar e editar camadas de vídeo

1. Importe seu vídeo principal **V1**.
2. Na Biblioteca, clique em **▧ Adicionar vídeo em camada** e selecione outro vídeo.
3. Ele aparece numa faixa separada **V2**, acima do vídeo principal. É possível adicionar até quatro sobreposições, nas faixas **V2–V5**.
4. Arraste o clipe da faixa para alterar seu início na timeline; selecione o clipe para usar os ajustes da lateral direita: início da mídia, fim da mídia, início na timeline, tamanho, opacidade, posição horizontal/vertical, ocultar e excluir.
5. A prévia exibe as camadas reproduzíveis pelo navegador sobre o vídeo principal. A exportação FFmpeg compõe as camadas respeitando suas posições e opacidade, independentemente do suporte do navegador ao codec.
6. A faixa musical **A1** continua independente das camadas de imagem. Seus botões de silenciar áudio V1 e A1, marcadores **M**, Motion Blur e preset TikTok HQ são preservados.

**Escopo atual:** são camadas independentes de **vídeo** para picture-in-picture/sobreposição, uma mídia por faixa V2–V5. Os vídeos de sobreposição entram **sem o próprio áudio** (use A1 para música). A versão principal ainda não oferece texto, stickers ou transições multicamadas, nem vários clipes em uma mesma faixa de sobreposição. As mídias importadas ficam em `data/layers/`, e um projeto JSON salvo referencia os IDs: para abrir em outra instalação, também será preciso transportar as mídias. São aceitos MP4, MOV, MKV, WebM, AVI e M4V pelo FFmpeg, mas alguns codecs não aparecem na prévia do navegador.

**Desempenho:** a quantidade máxima de camadas é quatro para evitar consumo excessivo; em máquinas de pouca RAM, use menos sobreposições e exporte trechos curtos ao conferir efeitos.
