# CLAUDE.md

Guia rápido do repositório para quem (ou o que) for mexer no código.

## O que é

Gabaritaço é um formatador local: você envia arquivos `.docx` "brutos"
marcados com uma sintaxe própria (ver `references/sintaxe.md`) e a aplicação
gera um PDF e um DOCX formatados no padrão Gabaritaço – VDE Concursos,
agrupando por matéria (`DISCIPLINA:`) automaticamente.

## Pipeline

1. `src/docxParser.js` — lê o `.docx` bruto (via `jszip` + `@xmldom/xmldom`,
   direto no XML do OOXML) e produz uma lista plana de blocos
   (`{kind:'marker'|'text'|'table'|'table-caption', ...}`).
2. `src/sectionBuilder.js` — consome esses blocos e monta a estrutura final
   (`{ disciplina, selo, subtitulo, sections: [{ titulo, items: [...] }] }`).
3. `src/templateRenderer.js` — renderiza essa estrutura como HTML/CSS
   (layout A4, 2 colunas) para virar PDF via Playwright/Chromium
   (`src/pdfRenderer.js`).
4. `src/docxRenderer.js` — renderiza a mesma estrutura como um `.docx`
   editável (biblioteca `docx`), replicando o mesmo visual em Word.
5. `src/roundTripStyles.js` — estilos de parágrafo invisíveis que o DOCX
   gerado carrega, para que um arquivo baixado, editado no Word e
   reenviado seja reconhecido de volta pelo parser sem precisar da sintaxe
   `MARCADOR:` literal.

`server.js` expõe a API usada pelo front-end estático em `public/`
(upload, listagem de matérias, geração/download de PDF e DOCX).

## Marcadores válidos (sintaxe do arquivo bruto)

Ver `references/sintaxe.md` para a referência completa com exemplos. Lista
atual (definida em `MARKERS`, `src/docxParser.js`):

`DISCIPLINA`, `SELO`, `SUBTITULO`, `TITULO_SECAO`, `DICA`, `LEI`, `ALERTA`,
`TABELA`, `JURISPRUDENCIA`, `ARTIGOS`, `SUMULAS`, `COMENTARIO_ARTIGO`,
`REFERENCIAS`, `MAPA_MENTAL`, `QUESTAO`, `ENUNCIADO`, `GABARITO`,
`COMENTARIOS`.

Ao adicionar um marcador novo, ele geralmente precisa ser tocado em:
`src/docxParser.js` (`MARKERS`/`MARKER_ACCENT_ALTS`), `src/sectionBuilder.js`
(novo `case` + qualquer pós-processamento), `src/templateRenderer.js`
(render HTML/CSS), `src/docxRenderer.js` (render DOCX) e, se o marcador deve
sobreviver a um ciclo de download → edição no Word → reenvio,
`src/roundTripStyles.js` (`MARKER_NAMES`).

## Rodando localmente

```bash
npm install
npm run setup-browser   # baixa o Chromium usado para gerar o PDF (só na 1ª vez)
npm start
```

Abre em `http://localhost:4173`.

## Notas para desenvolvimento

- Não há suite de testes nem linter configurados neste repositório.
- Geração de PDF depende do Chromium do Playwright (`npm run setup-browser`);
  sem ele, `src/pdfRenderer.js` falha ao tentar lançar o browser.
- Dados de matérias/uploads ficam em `data/` (não versionado, resetável
  apagando a pasta).
- Cores e estilos do PDF ficam embutidos inline em `src/templateRenderer.js`
  (mais o CSS específico do MAPA_MENTAL em `assets/style.css`, injetado no
  mesmo `<style>`) — sempre embutidos como string em vez de linkados,
  porque `page.setContent()` não tem base URL para resolver `<link>`/fontes
  externas.
# CLAUDE.md — Gabaritaço Formatter

Este arquivo orienta o Claude ao trabalhar neste repositório. Leia-o antes de propor qualquer mudança.

## Sobre o projeto

Aplicação que transforma material bruto de revisão (dicas, artigos de lei, questões comentadas) no padrão visual **"Gabaritaço"** da VDE Concursos, gerando dois arquivos: um **PDF** final (pronto para postar) e um **DOCX** editável com o mesmo conteúdo. É usado na produção de material de revisão para concursos e OAB.

## Como você (Claude) deve se comportar aqui

- Responda e comente sempre em **português do Brasil**.
- Antes de mudanças grandes, **explique o plano e espere confirmação**; prefira alterações pequenas e fáceis de revisar.
- **Preserve o padrão visual do Gabaritaço** (cores, fonte, layout). Não altere cores, fontes ou a sintaxe de marcadores por conta própria — só quando for explicitamente pedido.
- Quando algo estiver ambíguo, **pergunte** em vez de adivinhar.
- Não reescreva código que já funciona sem necessidade.

## Estrutura do projeto

> Confira se bate com o seu repositório e ajuste os caminhos se estiver diferente (esta é a estrutura de referência do formatter).

```
scripts/
  parse_raw.py     → lê o .txt com marcadores e organiza em blocos
  render_html.py   → blocos → HTML no layout Gabaritaço
  build.py         → orquestra tudo e gera o PDF (via Chromium headless)
  build_docx.js    → blocos (JSON) → DOCX editável
assets/
  style.css        → cores, fontes e todos os componentes visuais
references/
  sintaxe.md       → guia completo da sintaxe de marcadores
```

## Como gerar os materiais

```
python3 scripts/build.py <material_bruto.txt> <saida_sem_extensao>
node scripts/build_docx.js <saida_sem_extensao>.blocks.json <saida_sem_extensao>.docx
```

Sempre renderize o PDF em imagem e confira visualmente antes de considerar pronto — quebras de página e boxes cortados entre colunas são os erros mais comuns:

```
pdftoppm -png -r 100 <saida>.pdf preview
```

## Padrão visual — NÃO alterar sem pedido explícito

Todas as cores e fontes ficam centralizadas em `assets/style.css`. Se for pedido um ajuste de cor, edite **somente ali** — nunca espalhe cor pelos scripts.

| Elemento | Hex |
|---|---|
| Roxo principal (títulos, badges, cabeçalho de tabela) | `#5A009F` |
| Roxo da capa | `#4F0293` |
| Amarelo (badge DICA, selo) | `#FDD60A` |
| Box de lei/alerta (lilás) | `#D8D3FA` |
| Box de definição/questão (cinza) | `#F6F6F6` |

Fonte: **Poppins**.

## Sintaxe de marcadores (o material bruto usa isto)

Marcadores válidos: `DISCIPLINA`, `SELO`, `SUBTITULO`, `TITULO_SECAO`, `DICA`, `LEI`, `ALERTA`, `TABELA`, `QUESTAO` (com `ENUNCIADO`, `GABARITO`, `COMENTARIOS`), `ARTIGOS`, `SUMULAS`.

Regras que o código deve sempre respeitar:

- `DICA` é numerada **automaticamente** (DICA 01, DICA 02...). Nunca escreva o número à mão no conteúdo.
- `**texto**` vira **negrito**.
- Linha em branco dentro de um bloco de texto = novo parágrafo.
- `TITULO_SECAO` abre uma nova seção temática e força quebra de página (exceto a primeira, que vem logo após a capa).

## Limitações conhecidas (não "consertar" sem pedir)

- O **DOCX** não reproduz cantos arredondados/sombra dos boxes (limitação do Word) — usa retângulos preenchidos equivalentes. Isso é esperado.
- Hoje só o padrão **"Gabaritaço 1ª Fase"** (DICA + COMO JÁ CAIU + ARTIGOS) está implementado. O padrão "2ª Fase" ainda não existe.

## A confirmar / preencher

- Versão de Python e de Node usadas no projeto, e como instalar as dependências (ex.: `pip install -r requirements.txt`, `npm install`).
- Qualquer detalhe do repositório que fuja da estrutura descrita acima.
