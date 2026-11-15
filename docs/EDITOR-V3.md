# Video Enhancer V3 — Workspace experimental

**Objetivo:** tornar confortável editar clipes, em vez de adicionar efeitos sobre uma timeline problemática. O editor V3 é isolado do editor estável; nenhum arquivo existente do V1 foi substituído.

## Abrir

Na pasta do projeto no Windows:

```powershell
git fetch origin
git switch feature/editor-v3-workspace
pip install -r requirements.txt
python app.py
```

Abrir **http://127.0.0.1:8000/static/v3/index.html**. Para voltar ao V1, clique em *Editor antigo*, ou `git switch main`.

## Fluxo implementado nesta primeira fase

- Interface com biblioteca, monitor, propriedades e timeline maior, com zoom e rolagem.
- Importação de um vídeo principal; preview em HTMLVideoElement nativo, sem renderização contínua via FFmpeg.
- Divisão no cursor (S), arraste de clipes, aparo nas bordas, magnetismo de 12 px, exclusão com fechamento de espaço e desfazer/refazer (40 ações).
- Marcadores manuais (M) criados diretamente no tempo da timeline.
- Ajuste de posição, escala horizontal e vertical independentes, rotação, centralização, preencher e **esticar para toda a composição**. Arrastar na prévia e redimensionar pelos cantos.
- Quatro sobreposições opcionais V2–V5, com posição pela prévia, escala, transparência, tempo e ocultar. Uma mídia por faixa de sobreposição.
- Música MP3 independente A1, com silenciamento e reprodução aproximada sincronizada.
- Presets de resolução (16:9, 9:16, 1:1 e original), 24/30/60 FPS e exportação MP4 via backend do editor atual, incluindo sobreposições, vídeo V1 e MP3 A1.
- Projeto JSON exportável, com URLs/IDs das mídias adicionais. A mídia original precisa ser reimportada ao abrir JSON.

## Escopo e limitações importantes

**É um laboratório funcional para testar a usabilidade, não substituto pronto do CapCut.** A prévia usa reprodução nativa do navegador, pode ter pequenas discrepâncias de sincronização em cortes ou vídeos com codecs exóticos e não mostra filtros FFmpeg nem Motion Blur óptico (estes não foram portados para V3 ainda). Os arquivos MKV/MOV e codecs especiais podem exportar no FFmpeg, mas não necessariamente reproduzir no navegador. Exportar exige FFmpeg instalado; o processamento continua local, sem gastos com servidor. A biblioteca aceita uma única origem de vídeo na V1 e até uma mídia por faixa V2–V5; não existe ainda texto, transições, keyframes, aninhamento, proxy cache ou renderização GPU.

Vídeos de sobreposição têm o próprio áudio descartado por enquanto. O áudio original V1 pode ser silenciado de forma independente da música A1. Não mova arquivos de `data/` entre sessões; as mídias auxiliares ficam lá. Para compartilhar projetos entre computadores, será necessário empacotar esses arquivos numa fase futura.

## Como testar

1. Importe um vídeo, execute várias divisões com S, reposicione os pedaços, teste zoom/magnetismo.
2. Com um clipe selecionado, clique **Esticar na composição** e arraste os cantos. Confira que posição e tamanho permanecem após cortes.
3. Importe outra gravação como sobreposição e MP3 para A1. Mova as camadas, altere transparência e faça uma exportação de vídeo de poucos segundos.
4. Salve o JSON e reabra com o vídeo original carregado.

A implementação contém verificações de sintaxe em GitHub Actions e se beneficia do smoke test FFmpeg existente (que agora cobre uma sobreposição); a reprodução e interação do browser ainda precisam de validação manual antes de integração na `main`.

## Próxima fase após feedback

Melhorar snapping em operações entre várias faixas, trim de sobreposições, waveform real da música, painel de efeitos, preview com cache/worker e equivalência visual entre preview/export.
