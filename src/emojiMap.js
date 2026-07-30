'use strict';

// Heuristica de palavra-chave -> emoji para a "figurinha" ao lado de cada
// DICA. Nao ha marcador de figurinha no docx bruto (por definicao do
// usuario) - o emoji e escolhido a partir do titulo + corpo da dica.
//
// A lista de emojis candidatos foi checada contra o dataset publico do
// GitHub (github.com/muan/emojilib - mesma base usada no seletor de emoji
// do github.com) para garantir que cada glifo escolhido existe e tem o
// significado correto; a curadoria de qual termo juridico casa com qual
// emoji foi feita a mao, organizada por materia. Todos os glifos abaixo
// foram renderizados e conferidos visualmente antes de entrar na lista.
//
// O texto e comparado sem acentos (ver stripAccents), entao os padroes
// abaixo sao escritos sem acentuacao.
const KEYWORDS = [
  // --- Constitucional -------------------------------------------------
  [/constitui(cao|cional)|direitos? fundamental|clausula petrea|emenda constitucional/, '⚖️'],
  [/controle de constitucionalidade|\badi\b|\badpf\b|\badc\b|inconstitucional/, '📜'],
  [/justica federal|competencia federal|\bstf\b|\bstj\b|tribunal|jurisdicao|supremo/, '🏛️'],
  [/poder legislativo|congresso|camara dos deputados|senado/, '🏛️'],
  [/poder executivo|presidente da republica|ministro de estado/, '🏢'],
  [/poder judiciario|separacao dos poderes|freios e contrapesos/, '⚖️'],
  [/estado de defesa|estado de sitio|intervencao federal/, '🚨'],
  [/direitos humanos|dignidade da pessoa humana/, '🕊️'],

  // --- Administrativo ---------------------------------------------------
  [/licitac(ao|oes)|pregao|edital de licitacao/, '📋'],
  [/contrato administrativo|concessao|permissao de servico/, '📄'],
  [/servidor publico|estatutario|estabilidade|concurso publico|edital/, '📝'],
  [/improbidade administrativa/, '🚫'],
  [/poder de policia|policia administrativa/, '🚨'],
  [/ato administrativo|discricionari|vinculad/, '🗂️'],
  [/desapropriac/, '🏚️'],
  [/servico publico|agencia reguladora|concessionaria/, '🏢'],
  [/administracao publica|administrativo/, '🏛️'],

  // --- Civil -------------------------------------------------------------
  [/pessoa natural|pessoa juridica|capacidade civil/, '🧑'],
  [/negocio juridico|ato juridico/, '📄'],
  [/contrato|clausula contratual/, '📄'],
  [/obrigac(ao|oes)|credor|devedor/, '🧾'],
  [/responsabilidade civil|dano moral|dano material|indenizac/, '💶'],
  [/imovel|propriedade|posse|registro de imoveis|usucapiao/, '🏠'],
  [/familia|casamento|uniao estavel|divorcio|alimentos/, '👪'],
  [/sucess(ao|oes)|heranca|inventario|testamento/, '📜'],
  [/prescric(ao)|decadencia|prazo/, '⏰'],

  // --- Penal ---------------------------------------------------------------
  [/homicidio|latrocinio|feminicidio/, '🔪'],
  [/furto|roubo|extorsao/, '🕵️'],
  [/trafico de drogas|entorpecent/, '💊'],
  [/corrupcao|peculato|concussao/, '💰'],
  [/legitima defesa|excludente de ilicitude/, '🛡️'],
  [/dolo|culpa|crime culposo/, '⚠️'],
  [/pena|prisao|regime fechado|regime semiaberto/, '🔒'],
  [/prisao preventiva|prisao temporaria|flagrante/, '🚔'],
  [/penal|criminal|crime\b/, '🚨'],

  // --- Processual (civil e penal) -----------------------------------------
  [/peticao inicial|contestac(ao)|reconvenc/, '📄'],
  [/citac(ao)|intimac(ao)/, '✉️'],
  [/recurso|apelac(ao)|agravo|embargos/, '📨'],
  [/sentenca|acordao|coisa julgada/, '⚖️'],
  [/execucao (de sentenca|civil|de titulo)|cumprimento de sentenca|penhora/, '🔨'],
  [/tutela|liminar|medida cautelar/, '🛡️'],
  [/prova|testemunha|pericia/, '🔎'],
  [/inquerito policial|delegacia/, '🚓'],

  // --- Tributário ----------------------------------------------------------
  [/tributari|imposto|\bicms\b|\biptu\b|\bipva\b|imposto de renda/, '💰'],
  [/divida ativa|execucao fiscal|fazenda publica|fisco/, '🧾'],
  [/contribuinte|isencao fiscal|beneficio fiscal/, '💵'],
  [/taxa|contribuicao de melhoria|contribuicao especial/, '💳'],

  // --- Trabalhista -----------------------------------------------------
  [/\bclt\b|celetista|empregado|empregador|carteira assinada/, '💼'],
  [/rescisao|justa causa|aviso previo/, '📄'],
  [/\bfgts\b|jornada de trabalho|hora extra/, '⏰'],
  [/greve|sindicato|acordo coletivo|dissidio/, '✊'],
  [/trabalh|servidor celetista/, '💼'],

  // --- Empresarial -------------------------------------------------------
  [/sociedade empresaria|sociedade limitada|sociedade anonima/, '🏢'],
  [/falencia|recuperacao judicial|insolvencia/, '📉'],
  [/titulo de credito|duplicata|cheque|nota promissoria/, '🧾'],
  [/marca|patente|propriedade industrial/, '🏷️'],
  [/empresa|comercio|comercial|mercantil/, '🏢'],

  // --- Consumidor ----------------------------------------------------------
  [/\bcdc\b|relacao de consumo|fornecedor|vicio do produto|propaganda enganosa/, '🛒'],
  [/consumidor/, '🛒'],

  // --- Ambiental -----------------------------------------------------------
  [/licenciamento ambiental|dano ambiental|crime ambiental|poluic(ao)/, '🏭'],
  [/meio ambiente|ambiental|sustentabilidade|desmatamento/, '🌳'],
  [/reciclagem|residuos solidos/, '♻️'],
  [/agua|recursos hidricos/, '💧'],

  // --- Eleitoral -----------------------------------------------------------
  [/eleic(ao|oes)|eleitoral|\btse\b|\btre\b|inelegibilidade/, '🗳️'],
  [/voto|urna|candidat/, '🗳️'],
  [/partido politico|propaganda eleitoral|coligac/, '🚩'],

  // --- Previdenciário --------------------------------------------------
  [/\binss\b|previdenci|aposentadoria|auxilio-doenca|auxilio doenca/, '👵'],
  [/beneficio previdenciario|pensao por morte/, '💶'],

  // --- Internacional -----------------------------------------------------
  [/tratado internacional|direito internacional|extradicao/, '🌐'],
  [/\bonu\b|organismo internacional|corte interamericana/, '🕊️'],

  // --- ECA / Infância e família -----------------------------------------
  [/crianca|adolescente|\beca\b|ato infracional|adocao/, '🧒'],
  [/menor|guarda compartilhada/, '👶'],

  // --- Financeiro / Bancário -------------------------------------------
  [/banco central|sistema financeiro|contrato bancario|juros/, '🏦'],
  [/cartao de credito|financiamento|emprestimo/, '💳'],

  // --- Digital / LGPD ------------------------------------------------------
  [/dados pessoais|\blgpd\b|protecao de dados/, '🔐'],
  [/crime cibernetico|internet|digital|tecnologia|rede social/, '💻'],

  // --- Termos gerais de concurso --------------------------------------
  [/sumula|jurisprudencia|entendimento do stf|entendimento do stj/, '📖'],
  [/doutrina|autor|classificac(ao) doutrinaria/, '📚'],
  [/saude|hospital|\bsus\b|medico/, '🏥'],
  [/seguranca publica|policia/, '🚨'],

  // Catch-all for generic "guarda" (child custody) not already caught by
  // the more specific ECA phrasing above - kept last on purpose so the more
  // specific matches above always win first.
  [/\bguarda\b/, '👪'],
];

const DEFAULT_EMOJI = '📌';

function stripAccents(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function pickEmoji(...texts) {
  const combined = stripAccents(texts.join(' ')).toLowerCase();
  for (const [re, emoji] of KEYWORDS) {
    if (re.test(combined)) return emoji;
  }
  return DEFAULT_EMOJI;
}

module.exports = { pickEmoji };
