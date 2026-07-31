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
