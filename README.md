# Gabaritaço – Formatador de Provas

Aplicação local: você envia arquivos `.docx` brutos (marcados com
`DISCIPLINA:`, `TITULO_SECAO:`, `DICA:`, `LEI:`, `ALERTA:`, `TABELA:`) e ela
gera o PDF formatado no padrão Gabaritaço – VDE Concursos, agrupando por
matéria automaticamente.

## Padrão do arquivo bruto

O `.docx` deve começar com estes campos (um por parágrafo):

```
DISCIPLINA: Direito Constitucional
SELO: VDE Concursos
SUBTITULO:
TITULO_SECAO: Controle de Constitucionalidade
DICA: Competência da Justiça Federal
Texto da dica. **Negrito manual** também funciona, além do negrito nativo do Word.

LEI: Art. 5º, CC
Texto do artigo de lei.

ALERTA:
Texto do alerta.

TABELA:
[tabela nativa do Word logo em seguida]
```

Regras:
- `DICA` é numerada automaticamente por seção (DICA 01, DICA 02…) — não escreva o número.
- Uma linha em branco dentro de um bloco de texto cria um novo parágrafo.
- `TITULO_SECAO` força quebra de página (exceto a primeira do documento) e reinicia a numeração de DICA.
- Cada `DICA` recebe um emoji temático automático (heurística por palavra-chave em `src/emojiMap.js` — ajuste a lista lá se quiser mudar os emojis).
- Arquivos com a mesma `DISCIPLINA:` são agrupados no mesmo PDF, na ordem em que forem enviados.

## Rodando localmente

```bash
cd app
npm install
npm run setup-browser   # baixa o Chromium usado para gerar o PDF (só na 1ª vez)
npm start
```

Abra http://localhost:4173

## Armazenamento

Tudo fica em `app/data/<matéria>/`: os `.docx` originais, a capa enviada e o
`output.pdf` gerado. Apagar essa pasta reseta a aplicação. Ela não é
versionada (está no `.gitignore`).
