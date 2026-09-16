// O JUIZ: o filtro que reprova recomendação genérica ANTES de ela chegar no
// João.
//
// POR QUE EM CÓDIGO E NÃO EM PROMPT (João, 16/09/2026: "recomendação
// genérica"): pedir num prompt "seja específico" é o tipo de instrução que o
// modelo concorda com entusiasmo e desobedece na frase seguinte. Já tinha uma
// lista de frases banidas no prompt de todo agente desde o começo, e mesmo
// assim saía "explorar o engajamento". Instrução é conselho; isto aqui é porta.
//
// A regra é dura e verificável, sem IA no meio: uma recomendação só passa se
// citar um CLUBE e um PRODUTO que existem no cardápio da rodada, trouxer um
// NÚMERO como evidência e um PRAZO reconhecível. Quem não passa volta pra mesa
// com o motivo exato e tem UMA chance de refazer. O que continuar reprovado é
// registrado na ata como reprovado — o João vê que a mesa tentou empurrar
// vaguidão, em vez de receber a vaguidão.
//
// O objetivo não é humilhar o modelo: é que "não temos recomendação hoje" seja
// um resultado melhor e mais barato do que uma frase bonita que ninguém
// consegue executar.

import type { Cardapio } from './fontes/cardapio';

export interface Recomendacao {
  o_que: string;
  por_que: string;
  quem: string;
  ate_quando: string;
  risco: string;
}

export interface Veredito {
  aprovada: boolean;
  motivos: string[];
}

/** minúsculas e sem acento — pra "Grêmio" casar com "gremio". */
export function normalizar(s: string): string {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Vocabulário de produto da casa. Entra junto com as famílias do cardápio
// porque a Nina fala "capinha" e "térmico", não "ACESSORIOS / CASE".
const PRODUTOS_DA_CASA = [
  'capinha', 'case', 'capa', 'termic', 'garrafa', 'copo', 'caneca', 'squeeze',
  'camiseta', 'camisa', 'moletom', 'bone', 'mochila', 'necessaire', 'estojo',
  'adesivo', 'poster', 'quadro', 'almofada', 'chaveiro', 'toalha', 'pet',
  'estampa', 'colecao', 'linha',
];

// O que não pode aparecer sozinho no lugar de uma decisão. Cada uma destas já
// saiu numa ata de verdade desta mesa.
const VAGUIDOES = [
  'explorar', 'aproveitar a data', 'reforcar a comunicacao', 'acompanhar de perto',
  'criar algo especial', 'potencializar', 'alavancar', 'engajamento', 'sinergia',
  'avaliar a possibilidade', 'estudar', 'mapear oportunidades', 'fortalecer a presenca',
  'trabalhar melhor', 'melhorar o processo', 'otimizar',
];

const TEM_NUMERO = /\d/;
// "até sexta", "19/09", "2026-09-19", "em 3 dias", "próxima semana", "antes do clássico"
const TEM_PRAZO = /(\d{1,2}\/\d{1,2})|(\d{4}-\d{2}-\d{2})|\bate\b|\bantes\b|\bhoje\b|\bamanha\b|\bsegunda\b|\bterca\b|\bquarta\b|\bquinta\b|\bsexta\b|\bsabado\b|\bdomingo\b|\bsemana\b|\bdias?\b/;

function citaAlgumDe(texto: string, lista: string[]): string | null {
  const t = normalizar(texto);
  for (const item of lista) {
    const n = normalizar(item);
    if (n.length >= 3 && t.includes(n)) return item;
  }
  return null;
}

/**
 * Julga UMA recomendação contra o cardápio da rodada. Sem IA: ou o texto cita
 * as coisas que existem, ou não cita.
 */
export function julgar(rec: Recomendacao, cardapio: Cardapio): Veredito {
  const motivos: string[] = [];
  const corpo = `${rec.o_que} ${rec.por_que}`;
  const tudo = `${rec.o_que} ${rec.por_que} ${rec.ate_quando}`;

  if (!rec.o_que || rec.o_que.trim().length < 15) {
    return { aprovada: false, motivos: ['a recomendação está vazia ou curta demais pra alguém executar'] };
  }

  // 1. Clube com nome. Só exigimos quando o cardápio de fato carregou clubes —
  // se a fonte caiu, não é justo (nem útil) reprovar por isso.
  if (cardapio.nomesDeClube.length && !citaAlgumDe(corpo, cardapio.nomesDeClube)) {
    motivos.push(
      `não diz DE QUAL CLUBE se trata. Escolha um da lista da rodada (ex.: ${cardapio.nomesDeClube.slice(0, 5).join(', ')}) ` +
      'e escreva o nome dele na recomendação.',
    );
  }

  // 2. Produto com nome: família/tipo do cardápio, produto lançado, ou palavra
  // do vocabulário da casa.
  const produtos = [
    ...cardapio.nomesDeFamilia,
    ...cardapio.lancamentos.map((l) => l.produto),
    ...PRODUTOS_DA_CASA,
  ];
  if (!citaAlgumDe(corpo, produtos)) {
    motivos.push(
      'não diz EM QUE PRODUTO. Nomeie a família ou o tipo (capinha, térmico, camiseta, caneca…) — ' +
      '"uma linha nova" não é produto, é intenção.',
    );
  }

  // 3. Evidência numérica: a recomendação nasce de um número ou não nasce.
  if (!TEM_NUMERO.test(rec.por_que)) {
    motivos.push('o "por quê" não tem um número. Cole a evidência da investigação — unidades, receita ou variação.');
  }

  // 4. Prazo executável.
  if (!TEM_PRAZO.test(normalizar(tudo))) {
    motivos.push('não tem prazo reconhecível. Data, dia da semana ou "até quando" — "o quanto antes" não é prazo.');
  }

  // 5. Vaguidão explícita.
  const vago = citaAlgumDe(rec.o_que, VAGUIDOES);
  if (vago) {
    motivos.push(`a frase se apoia em "${vago}", que é enfeite. Diga a ação concreta que substitui isso.`);
  }

  return { aprovada: motivos.length === 0, motivos };
}

export interface Julgamento {
  aprovadas: Recomendacao[];
  reprovadas: { rec: Recomendacao; motivos: string[] }[];
}

export function julgarTodas(recs: Recomendacao[], cardapio: Cardapio): Julgamento {
  const aprovadas: Recomendacao[] = [];
  const reprovadas: { rec: Recomendacao; motivos: string[] }[] = [];
  for (const r of recs) {
    const v = julgar(r, cardapio);
    if (v.aprovada) aprovadas.push(r);
    else reprovadas.push({ rec: r, motivos: v.motivos });
  }
  return { aprovadas, reprovadas };
}

/** O texto que volta pra mesa na segunda tentativa. Direto, com o motivo de cada uma. */
export function formatarReprovacao(reprovadas: { rec: Recomendacao; motivos: string[] }[]): string {
  return (
    '⚠ AS RECOMENDAÇÕES ABAIXO FORAM REPROVADAS NA CONFERÊNCIA. Elas não chegaram ao João, e não vão chegar ' +
    'do jeito que estão.\n\n' +
    reprovadas.map((r, i) =>
      `${i + 1}. "${r.rec.o_que}"\n   Reprovada porque:\n` + r.motivos.map((m) => `   - ${m}`).join('\n'),
    ).join('\n\n') +
    '\n\nRefaça SÓ estas, corrigindo exatamente o que está apontado. Duas saídas honestas existem e são ' +
    'melhores que insistir: (a) reescrever com clube, produto, número e prazo de verdade, tirados do cardápio ' +
    'da rodada; (b) devolver a lista VAZIA, dizendo que o dado de hoje não sustenta recomendação nenhuma. ' +
    'O que não vale é maquiar a mesma frase com outras palavras — a conferência é a mesma e vai reprovar de novo.'
  );
}
