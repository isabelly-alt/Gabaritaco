# Sintaxe do arquivo bruto (.docx)

Referência completa dos marcadores reconhecidos pelo parser
(`src/docxParser.js` + `src/sectionBuilder.js`). Cada marcador é escrito como
`NOME:` no início de um parágrafo; o texto que segue (na mesma linha e/ou nas
linhas seguintes, até o próximo marcador) é o conteúdo daquele bloco.

Um arquivo também pode ser escrito no "formato flexível" (Markdown convertido
para .docx, com títulos/negrito/emoji nativos em vez de marcadores literais)
— o parser reconhece ambos, mas a sintaxe abaixo é a recomendada para
arquivos digitados à mão.

## Campos do topo (um por parágrafo, uma vez por arquivo)

```
DISCIPLINA: Direito Constitucional
SELO: VDE Concursos
SUBTITULO: Módulo 2 - Controle de Constitucionalidade
```

- `DISCIPLINA` define a matéria — arquivos com a mesma `DISCIPLINA:` são
  agrupados no mesmo PDF/DOCX, na ordem em que forem enviados.
- `SELO` e `SUBTITULO` são opcionais.

## TITULO_SECAO

```
TITULO_SECAO: Controle de Constitucionalidade
```

Abre uma nova seção. Força quebra de página (exceto a primeira do
documento) e reinicia a numeração de `DICA`.

## DICA

```
DICA: Competência da Justiça Federal
Texto da dica. **Negrito manual** também funciona, além do negrito nativo do Word.
```

Numerada automaticamente por seção (DICA 01, DICA 02…) — não escreva o
número.

## LEI

```
LEI: Art. 5º, CC
Texto do artigo de lei.
```

## ALERTA

```
ALERTA:
Texto do alerta.
```

## JURISPRUDENCIA

```
JURISPRUDENCIA: Texto da ementa/citação (STF, ADI 6.649/DF, Julgamento: 15.9.2022).
Comentário livre que continua depois da citação já fechada vira uma nota fora da caixa.
```

## TABELA

```
TABELA:
[tabela nativa do Word logo em seguida]
```

## ARTIGOS / SUMULAS / REFERENCIAS

```
ARTIGOS: Art. 5º, CF; Art. 37, CF.
SUMULAS: Súmula 227 STJ; Súmula vinculante 25 STF.
REFERENCIAS: Artigos que merecem leitura
Lei 8.112/90
Lei 9.784/99
```

## COMENTARIO_ARTIGO

Abre uma caixa azul clara de comentário. Aceita a grafia literal do
marcador ou variações naturais em português — "Comentário(s)" seguido de
uma ou duas palavras de ligação (ao, à, à(s), da, sobre o, etc.) e o
assunto (Artigo, Jurisprudência ou Súmula, no singular ou plural, com ou
sem acento):

```
COMENTARIO_ARTIGO:
Texto do comentário ao artigo.

Comentários à Jurisprudência:
Texto do comentário à jurisprudência citada.

Comentários à Súmula:
Texto do comentário à súmula citada.
```

Qualquer uma dessas variações abre a mesma caixa visual, com a etiqueta
normalizada para "Comentário ao artigo" / "Comentário à jurisprudência" /
"Comentário à súmula", independentemente de como foi digitado (singular,
plural, com ou sem acento).

## MAPA_MENTAL

Bloco de mapa mental: um título opcional seguido de pares "nome do ramo" +
"texto explicativo", repetidos para quantos ramos forem necessários. **Não
há marcador entre ramos** — o parser detecta sozinho onde um ramo termina e
o outro começa: uma linha curta (até 6 palavras, até 45 caracteres, que não
termine em `.`, `:` ou `;`) é o nome de um novo ramo; todas as linhas
seguintes, até a próxima linha curta, são o texto explicativo daquele ramo.

```
MAPA_MENTAL: Controle de Constitucionalidade
Difuso
Exercido por qualquer juiz ou tribunal no caso concreto, com efeitos inter partes.
Concentrado
Exercido pelo STF em ação direta, com efeitos erga omnes e vinculantes.
Modulação de efeitos
Permite ao STF restringir os efeitos da decisão por segurança jurídica ou excepcional interesse social.
```

O título (`Controle de Constitucionalidade`) é opcional — pode-se escrever
apenas `MAPA_MENTAL:` e começar direto pelo primeiro ramo.

Cada ramo recebe uma cor de uma paleta de 5 cores que cicla automaticamente
(se houver mais ramos que cores, a paleta recomeça). A paleta está definida
em `assets/style.css` (PDF) e espelhada em `src/docxRenderer.js`
(`MAPA_MENTAL_COLORS`, para o DOCX).

- **PDF:** cada ramo vira um bloco empilhado — nome em negrito na cor do
  ramo, texto explicativo abaixo com a cor do ramo como acento (borda
  esquerda). O bloco inteiro não é cortado entre colunas
  (`break-inside: avoid`).
- **DOCX:** os ramos viram uma tabela sem bordas, um ramo por linha,
  empilhados um abaixo do outro — cada linha com altura ajustada ao tamanho
  do texto. Dentro de cada linha: nome do ramo em negrito na cor do ramo, e
  o texto explicativo abaixo.

## QUESTAO / ENUNCIADO / GABARITO / COMENTARIOS

Não fazem parte da sintaxe recomendada para novos arquivos, mas continuam
sendo reconhecidos (o design já inclui CSS/DOCX para o bloco de questão):

```
QUESTAO: Como já caiu
ENUNCIADO:
Texto do enunciado.
a) Alternativa A
b) Alternativa B
GABARITO: B
COMENTARIOS:
Texto do comentário.
```

## Regras gerais

- Uma linha em branco dentro de um bloco de texto cria um novo parágrafo.
- Cada marcador aceita, além do nome em ASCII, sua grafia acentuada em
  português (ex.: `SUBTÍTULO:`, `QUESTÃO:`, `COMENTÁRIOS:`) — ver
  `MARKER_ACCENT_ALTS` em `src/docxParser.js`.
