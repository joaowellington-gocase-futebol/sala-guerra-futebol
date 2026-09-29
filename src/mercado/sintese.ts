// A SÍNTESE — a ata reescrita em forma de conversa, pra quem lê no e-mail.
//
// Nasceu em 28/09/2026, do recado do João sobre o card: "queria que a ata no
// email fosse um pouco mais resumida. Quero um feedback geral, e quero que me
// dê um tema tipo: achamos que futebol e fontes únicas combinam, por XYZ;
// achamos que é conveniente fazer case para o Ceará, Coritiba ou qualquer time
// por isso ou aquilo, de fácil leitura."
//
// O card de antes despejava a leitura inteira — evidência, ponte de produto, o
// que confirma amanhã, as teses, o placar — e cortava cada campo no meio da
// frase. Era a ata com reticências, não um resumo. A leitura continua sendo
// feita e conferida pelo juiz exatamente como antes (src/mercado/leitura.ts);
// esta etapa só a traduz, e a página da ata segue com o detalhe completo.
//
// A régua é código, não prompt, pelo mesmo motivo do juiz: número que não saiu
// do que a rodada mediu derruba o item, e a frase é cortada no tamanho do card
// por palavra, nunca no meio.

import type { Env } from '../aiproxy';
import { chamarAgente } from '../aiproxy';
import { numerosDoTexto, type Leitura } from '../juiz';
import type { Parecer } from './parecer';
import type { Agenda } from '../agenda';

export interface Achamos {
  /** A ideia em uma frase, começando por "Achamos que". */
  ideia: string;
  /** O motivo, em linguagem de gente. */
  porque: string;
}

export interface Sintese {
  feedback_geral: string;
  achamos: Achamos[];
  /** O pedido ao João reescrito curto. Vazio quando a mesa não precisa de nada. */
  pedido: string;
  /**
   * O parecer de coleção (29/09/2026). Quando vem, é ele que abre o card e a
   * ata; os campos acima ficam preenchidos a partir dele pra quem só lê o
   * formato antigo (a salinha, atas velhas, a prévia).
   */
  parecer?: Parecer;
  /** Os jogos de licenciado da semana, que vão junto com a ata. */
  agenda?: Agenda;
}

/** A síntese tirada do parecer: o momento vira o feedback geral, os porquês viram os "achamos". */
export function sinteseDoParecer(p: Parecer): Sintese {
  return {
    feedback_geral: p.momento || p.veredito,
    achamos: p.porques.map((x) => ({ ideia: x.ideia, porque: x.porque })),
    pedido: p.pedido,
    parecer: p,
  };
}

const MAX_ACHAMOS = 3;
const TAM_FEEDBACK = 320;
const TAM_IDEIA = 140;
const TAM_PORQUE = 200;
const TAM_PEDIDO = 180;

/** Corta no fim da última palavra que cabe — o card não mostra frase partida. */
export function caber(texto: string, max: number): string {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max - 1);
  const ultimoEspaco = corte.lastIndexOf(' ');
  return (ultimoEspaco > max * 0.6 ? corte.slice(0, ultimoEspaco) : corte).replace(/[\s,;:—-]+$/, '') + '…';
}

function comAchamos(ideia: string): string {
  const t = ideia.trim().replace(/^[•\-–]\s*/, '');
  if (/^achamos\b/i.test(t)) return 'Achamos' + t.slice(7);
  return 'Achamos que ' + t.charAt(0).toLowerCase() + t.slice(1);
}

/**
 * Número citado que não está em lugar nenhum do que a rodada mediu. O 45 e o
 * 14 das janelas de tempo aparecem no material, então passam sozinhos.
 */
function numerosInventados(texto: string, conhecidos: Set<number>): number[] {
  return numerosDoTexto(texto).filter((n) => !conhecidos.has(n));
}

/** Sem IA: a síntese mínima tirada da própria leitura, pra o card nunca sair vazio. */
export function sinteseDeReserva(ctx: {
  se_eu_fosse_voce: string; leituras: Leitura[]; precisamos_de_voce: string;
}): Sintese {
  return {
    feedback_geral: caber(ctx.se_eu_fosse_voce, TAM_FEEDBACK),
    achamos: ctx.leituras.slice(0, MAX_ACHAMOS).map((l) => ({
      ideia: caber(comAchamos(String(l.o_que_o_mercado_pede).split(/(?<=[.:;])\s/)[0]), TAM_IDEIA),
      porque: caber(String(l.como_cabe).split(/(?<=[.:;])\s/)[0], TAM_PORQUE),
    })),
    pedido: caber(ctx.precisamos_de_voce, TAM_PEDIDO),
  };
}

export async function sintetizarParaOJoao(
  env: Env,
  ctx: {
    tema: string;
    se_eu_fosse_voce: string;
    leituras: Leitura[];
    lentes: string;
    teses: string;
    entregas: string;
    precisamos_de_voce: string;
    /** O que a rodada mediu: lançamentos, procura por clube, jogos, notícia. É a fonte dos números permitidos. */
    material: string[];
    /** Qualquer outro texto medido (achado da investigação, mapa) — só pra conferir número. */
    conferencia: string;
  },
): Promise<Sintese> {
  const reserva = sinteseDeReserva(ctx);
  if (!ctx.leituras.length && !ctx.se_eu_fosse_voce) return reserva;

  const system = [
    'Você escreve o e-mail que o JOÃO WELLINGTON, coordenador de futebol da Gocase, lê de manhã com a ata da ' +
    'reunião da mesa de mercado. A reunião já aconteceu e a leitura já foi conferida. Seu trabalho é só ' +
    'TRADUZIR para uma leitura de 30 segundos.',
    '',
    'O formato que ele pediu, nas palavras dele: "achamos que futebol e fontes únicas combinam, por XYZ; ' +
    'achamos que é conveniente fazer case para o Ceará, Coritiba ou qualquer time por isso ou aquilo, de ' +
    'fácil leitura".',
    '',
    'Devolva:',
    '• "feedback_geral": no máximo 2 frases curtas. O clima geral do mercado hoje e a única coisa que vale ' +
    'olhar. Como um colega falaria no corredor.',
    `• "achamos": de 1 a ${MAX_ACHAMOS} itens, cada um com:`,
    `    "ideia" — UMA frase começando por "Achamos que", até ${TAM_IDEIA} caracteres, juntando duas coisas ` +
    'concretas: um estilo/linguagem visual e um produto da casa (ex. de forma: "Achamos que numeração ' +
    'grande e fonte única combinam com copo térmico"), OU um clube e o tipo de case (ex. de forma: "Achamos ' +
    'que vale fazer case do Ceará agora"). Clube só entra quando o material abaixo traz um sinal DAQUELE ' +
    'clube (procura subindo, jogo próximo, clássico, camisa nova).',
    `    "porque" — até ${TAM_PORQUE} caracteres, o motivo em uma frase. No máximo UM número, e ele tem que ` +
    'estar escrito no material abaixo.',
    `• "pedido": o que a mesa precisa que ele decida, em até ${TAM_PEDIDO} caracteres. Vazio se não precisa.`,
    '',
    'PROIBIDO no texto (é jargão interno da mesa, ele não usa): "empurrão", "share", "família", "rodada", ' +
    '"tese", "prateleira", "confiança", "recorte", "SKU", "sinal externo", "frentes medidas". Sem emoji, sem ' +
    'aspas, sem parênteses com fonte.',
    '',
    'Não invente nada que não esteja abaixo. Se só uma ideia se sustenta, devolva uma.',
    '',
    'Responda APENAS {"feedback_geral":"..","achamos":[{"ideia":"..","porque":".."}],"pedido":".."}',
  ].join('\n');

  const corpo = [
    'PAUTA: ' + ctx.tema,
    ctx.se_eu_fosse_voce ? '\nO QUE A MESA DIRIA SE SÓ DESSE PRA OLHAR UMA COISA:\n' + ctx.se_eu_fosse_voce : '',
    ctx.leituras.length
      ? '\nAS LEITURAS CONFERIDAS:\n' + ctx.leituras.map((l, i) =>
        `${i + 1}. O que o mercado pede: ${l.o_que_o_mercado_pede}\n   Números: ${l.evidencia}\n` +
        `   Como cabe nos produtos da casa: ${l.como_cabe}`).join('\n')
      : '',
    ctx.material.length ? '\nO QUE FOI MEDIDO HOJE:\n' + ctx.material.map((m) => '- ' + m).join('\n') : '',
    ctx.teses ? '\nAS IDEIAS QUE A MESA VEM SUSTENTANDO:\n' + ctx.teses : '',
    ctx.lentes ? '\nO QUE CADA UM DA MESA DISSE:\n' + ctx.lentes : '',
    ctx.entregas ? '\nO QUE ELE TINHA PEDIDO E FOI RESPONDIDO:\n' + ctx.entregas : '',
    ctx.precisamos_de_voce ? '\nO QUE A MESA PRECISA DELE:\n' + ctx.precisamos_de_voce : '',
  ].filter(Boolean).join('\n');

  const r = await chamarAgente(env, system, corpo, undefined, 0.35);
  if (!r.ok) return reserva;
  const d = r.dados as any;

  const conhecidos = new Set(numerosDoTexto(corpo + '\n' + ctx.conferencia));
  const achamos: Achamos[] = (Array.isArray(d?.achamos) ? d.achamos : [])
    .map((a: any) => ({ ideia: String(a?.ideia || '').trim(), porque: String(a?.porque || '').trim() }))
    .filter((a: Achamos) => a.ideia && a.porque)
    // Número que ninguém mediu derruba o item inteiro: um "porque" com
    // número errado é pior que um item a menos.
    .filter((a: Achamos) => !numerosInventados(a.ideia + ' ' + a.porque, conhecidos).length)
    .slice(0, MAX_ACHAMOS)
    .map((a: Achamos) => ({ ideia: caber(comAchamos(a.ideia), TAM_IDEIA), porque: caber(a.porque, TAM_PORQUE) }));

  const feedback = String(d?.feedback_geral || '').trim();
  return {
    feedback_geral: feedback && !numerosInventados(feedback, conhecidos).length
      ? caber(feedback, TAM_FEEDBACK)
      : reserva.feedback_geral,
    achamos: achamos.length ? achamos : reserva.achamos,
    pedido: ctx.precisamos_de_voce ? caber(String(d?.pedido || '').trim() || ctx.precisamos_de_voce, TAM_PEDIDO) : '',
  };
}
