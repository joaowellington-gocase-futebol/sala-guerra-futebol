// AS TESES — o fio que atravessa as reuniões.
//
// POR QUE (João, 22/09/2026): "preciso que entendam de forma progressiva as
// reuniões". A mesa investigava bem e esquecia: cada rodada abria um assunto
// novo, e o entendimento nunca engrossava. Uma reunião por dia que recomeça do
// zero todo dia é um gerador de opinião, não uma equipe que aprende.
//
// A boa notícia é que a peça já existia e estava escondida: a tabela `crencas`
// (src/db.ts) guarda o que a mesa passou a acreditar, com evidência e
// confiança, e a investigação é obrigada a tentar derrubar o que está de pé
// (src/investigacao.ts). O que faltava era só isto:
//
//   VISIBILIDADE  a crença vivia no prompt da investigação e morria lá. Agora
//                 ela abre a reunião, entra no fecho e aparece na ata e no
//                 card — o João vê a tese e vê o que ela andou.
//   MOVIMENTO     dizer, a cada rodada, o que aconteceu com cada tese:
//                 confirmou, nasceu, caiu ou ficou parada. Sem chamada de IA:
//                 é a comparação entre o estado de antes e o de depois.
//   PODA          tese não revisada há uma semana some da mesa. Sem isso a
//                 lista cresce para sempre e o prompt vira um monte de coisas
//                 velhas que ninguém está mais investigando.

import type { Env } from './aiproxy';

export interface Tese {
  id: number;
  afirmacao: string;
  evidencia: string;
  confianca: number;
  vezes_confirmada: number;
  revisada_em: string;
}

export type Movimento = 'confirmou' | 'nasceu' | 'caiu' | 'parada';

export interface MovimentoDaTese {
  afirmacao: string;
  movimento: Movimento;
  /** O que mudou nesta rodada — a evidência nova, ou o motivo da queda. */
  o_que_mudou: string;
  rodadas: number;
}

/**
 * Quantas teses a mesa carrega ao mesmo tempo. Três é pouco de propósito: o
 * pedido foi APROFUNDAR, e não dá pra aprofundar dez coisas por dia.
 */
export const MAX_TESES_VIVAS = 3;

/** Quantos dias uma tese pode ficar sem ser revisada antes de sair da mesa. */
const DIAS_ATE_ARQUIVAR = 7;

export async function tesesVivas(env: Env, limite = MAX_TESES_VIVAS): Promise<Tese[]> {
  const q = await env.DB.query(
    "SELECT id, afirmacao, evidencia, confianca, vezes_confirmada, revisada_em FROM crencas " +
    "WHERE status = 'viva' ORDER BY confianca DESC, vezes_confirmada DESC, id DESC LIMIT ?",
    [limite],
  );
  return q.rows.map((r) => ({
    id: Number(r.id),
    afirmacao: String(r.afirmacao || ''),
    evidencia: String(r.evidencia || ''),
    confianca: Number(r.confianca || 0),
    vezes_confirmada: Number(r.vezes_confirmada || 1),
    revisada_em: String(r.revisada_em || ''),
  }));
}

/**
 * Tira da mesa o que ninguém está mais investigando: tese parada há mais de
 * uma semana, e o excedente além do teto (as mais fracas primeiro). Arquivar
 * não apaga — a linha continua no banco com status 'arquivada'.
 */
export async function podarTeses(env: Env): Promise<number> {
  const limite = new Date(Date.now() - DIAS_ATE_ARQUIVAR * 86400000).toISOString();
  let podadas = 0;
  try {
    const paradas = await env.DB.query(
      "SELECT id FROM crencas WHERE status = 'viva' AND (revisada_em IS NULL OR revisada_em < ?)", [limite]);
    for (const r of paradas.rows) {
      await env.DB.exec("UPDATE crencas SET status = 'arquivada' WHERE id = ?", [Number(r.id)]);
      podadas += 1;
    }
    const excedente = await env.DB.query(
      "SELECT id FROM crencas WHERE status = 'viva' ORDER BY confianca DESC, vezes_confirmada DESC, id DESC " +
      "LIMIT -1 OFFSET ?", [MAX_TESES_VIVAS]);
    for (const r of excedente.rows) {
      await env.DB.exec("UPDATE crencas SET status = 'arquivada' WHERE id = ?", [Number(r.id)]);
      podadas += 1;
    }
  } catch { /* a poda é higiene, nunca motivo pra reunião falhar */ }
  return podadas;
}

const mesmaCoisa = (a: string, b: string) =>
  String(a || '').toLowerCase().slice(0, 50) === String(b || '').toLowerCase().slice(0, 50);

/**
 * O que aconteceu com cada tese nesta rodada. Comparação pura entre o estado
 * de antes da investigação e o resultado dela — nenhuma chamada de IA, nenhum
 * julgamento: ou o número mexeu na tese, ou não mexeu.
 */
export function movimentoDaRodada(
  antes: Tese[],
  resultado: {
    passamosAAcreditar: { afirmacao: string; evidencia: string }[];
    caiuPorTerra: { afirmacao: string; por_que: string }[];
  },
): MovimentoDaTese[] {
  const movimentos: MovimentoDaTese[] = [];

  for (const nova of resultado.passamosAAcreditar) {
    const velha = antes.find((t) => mesmaCoisa(t.afirmacao, nova.afirmacao));
    movimentos.push({
      afirmacao: nova.afirmacao,
      movimento: velha ? 'confirmou' : 'nasceu',
      o_que_mudou: nova.evidencia,
      rodadas: velha ? velha.vezes_confirmada + 1 : 1,
    });
  }

  for (const caida of resultado.caiuPorTerra) {
    const velha = antes.find((t) => mesmaCoisa(t.afirmacao, caida.afirmacao));
    movimentos.push({
      afirmacao: caida.afirmacao,
      movimento: 'caiu',
      o_que_mudou: caida.por_que,
      rodadas: velha ? velha.vezes_confirmada : 1,
    });
  }

  // O que ninguém tocou. É informação: uma tese que passa rodadas parada ou
  // não interessa mais, ou a mesa está fugindo dela.
  for (const t of antes) {
    if (movimentos.some((m) => mesmaCoisa(m.afirmacao, t.afirmacao))) continue;
    movimentos.push({
      afirmacao: t.afirmacao,
      movimento: 'parada',
      o_que_mudou: 'nenhuma medição desta rodada tocou nesta tese',
      rodadas: t.vezes_confirmada,
    });
  }

  return movimentos;
}

/** O bloco que ABRE a reunião. É o "onde paramos ontem". */
export function formatarTesesParaPrompt(teses: Tese[]): string {
  if (!teses.length) {
    return (
      '━━ ONDE A MESA PAROU ━━\n' +
      'A mesa ainda não tem tese nenhuma de pé. Esta rodada é a que funda a primeira: uma afirmação sobre o ' +
      'que o mercado masculino está pedindo, que as próximas reuniões vão poder confirmar ou derrubar.'
    );
  }
  return (
    '━━ ONDE A MESA PAROU — as teses que estão de pé ━━\n' +
    'Isto não é história, é o trabalho em aberto. Cada uma nasceu de um número e sobreviveu às rodadas ' +
    'seguintes. Sua obrigação hoje é fazer alguma coisa com elas: engrossar com medição nova, refinar o ' +
    'recorte, ou derrubar. O que você NÃO pode é ignorá-las e abrir assunto novo do nada.\n' +
    teses.map((t, i) =>
      (i + 1) + '. "' + t.afirmacao + '"\n' +
      '   sustentada por: ' + (t.evidencia || 'sem evidência registrada') + '\n' +
      '   já sobreviveu a ' + t.vezes_confirmada + ' rodada(s); confiança ' + t.confianca.toFixed(2),
    ).join('\n')
  );
}

/** O bloco do movimento, para a ata e o card — o que andou desde ontem. */
export function formatarMovimento(movimentos: MovimentoDaTese[]): string {
  if (!movimentos.length) return '';
  const rotulo: Record<Movimento, string> = {
    confirmou: '↑ engrossou',
    nasceu: '✦ nasceu',
    caiu: '✕ caiu',
    parada: '· parada',
  };
  return movimentos.map((m) =>
    rotulo[m.movimento] + ' — "' + m.afirmacao + '"' +
    (m.movimento === 'parada' ? '' : ': ' + String(m.o_que_mudou || '').slice(0, 220)) +
    (m.movimento === 'confirmou' ? ' (' + m.rodadas + ' rodadas de pé)' : ''),
  ).join('\n');
}
