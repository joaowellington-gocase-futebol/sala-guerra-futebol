// O CARDÁPIO — as opções reais da rodada, com nome próprio.
//
// Existe pra resolver a queixa de "recomendação genérica": a mesa não inventa o
// que fazer, ela ESCOLHE daqui, e a escolha é conferível (o juiz reprova quem
// citar clube ou produto que não está nesta lista).
//
// O QUE MUDOU EM 18/09/2026: o cardápio era montado por consulta à venda
// própria no datamart — que o João não audita ("nem sei como tá sendo calculado
// isso") e que vivia estourando o timeout de 40s, travando a mesa inteira, já
// que sem cardápio o juiz reprovava tudo. Agora ele é montado com dado de
// mercado que já está na mão da reunião: quem joga, quem o público procura, e
// o que a concorrência tem na prateleira e a que preço. Nenhuma consulta, nada
// que possa cair.

import type { Mundo } from '../web/mundo';
import type { Vitrine, CategoriaDaVitrine } from '../web/vitrine';
import type { Jogo } from '../web/calendario';

/** O que a casa sabe fabricar. Lista curta e explícita: é o chão da recomendação. */
export const PRODUTOS_DA_CASA = [
  'capinha', 'térmico', 'garrafa', 'copo', 'caneca', 'camiseta', 'moletom',
  'boné', 'mochila', 'almofada', 'adesivo', 'chaveiro', 'toalha', 'estampa',
];

export interface ClubeNoCardapio {
  clube: string;
  procura_14d: number;
  variacao_pct: number | null;
  joga_em_dias: number | null;
  classico: boolean;
}

export interface Cardapio {
  ok: boolean;
  clubes: ClubeNoCardapio[];
  categorias: CategoriaDaVitrine[];
  produtosDaCasa: string[];
  jogos: Jogo[];
  falhas: string[];
  /** O gabarito do juiz: o que uma recomendação pode citar. */
  nomesDeClube: string[];
  nomesDeFamilia: string[];
}

/** Síncrono de propósito: o dado já foi coletado, aqui é só cruzamento. */
export function montarCardapio(mundo: Mundo, vitrine: Vitrine): Cardapio {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const nomes = new Set<string>([
    ...mundo.clubesEmJogo,
    ...mundo.procura.clubes.map((c) => c.clube),
  ]);

  const clubes: ClubeNoCardapio[] = [...nomes].map((clube) => {
    const p = mundo.procura.clubes.find((x) => norm(x.clube) === norm(clube)
      || norm(x.clube).includes(norm(clube)) || norm(clube).includes(norm(x.clube)));
    const jogo = mundo.calendario.proximos.find((j) =>
      norm(j.mandante).includes(norm(clube)) || norm(j.visitante).includes(norm(clube)));
    return {
      clube,
      procura_14d: p?.views_14d ?? 0,
      variacao_pct: p?.variacao_pct ?? null,
      joga_em_dias: jogo?.em_dias ?? null,
      classico: !!jogo?.classico,
    };
  }).sort((a, b) => {
    // Quem joga primeiro vem primeiro; sem jogo, ordena por procura.
    if (a.joga_em_dias !== null && b.joga_em_dias !== null) return a.joga_em_dias - b.joga_em_dias;
    if (a.joga_em_dias !== null) return -1;
    if (b.joga_em_dias !== null) return 1;
    return b.procura_14d - a.procura_14d;
  });

  const falhas = [...mundo.falhas, ...vitrine.falhas];

  return {
    ok: clubes.length > 0,
    clubes,
    categorias: vitrine.categorias,
    produtosDaCasa: PRODUTOS_DA_CASA,
    jogos: mundo.calendario.proximos,
    falhas,
    nomesDeClube: clubes.map((c) => c.clube),
    nomesDeFamilia: [
      ...PRODUTOS_DA_CASA,
      ...vitrine.categorias.map((c) => c.tipo.split('·').pop()!.trim()),
    ],
  };
}

export function formatarCardapio(c: Cardapio): string {
  if (!c.ok) {
    return 'O CARDÁPIO NÃO CARREGOU nesta rodada' + (c.falhas.length ? ` (${c.falhas.join('; ')})` : '') +
      '. Sem ele você não tem como recomendar com nome próprio — diga isso em vez de inventar.';
  }

  const partes: string[] = ['━━ AS OPÇÕES REAIS DESTA RODADA (escolha daqui; não invente fora daqui) ━━'];

  partes.push(
    '\nCLUBES — quem joga e quanta gente está procurando (procura = leituras na Wikipédia em 14 dias):\n' +
    c.clubes.slice(0, 16).map((x) =>
      `- ${x.clube}: ` +
      (x.joga_em_dias === null ? 'sem jogo na janela' : `joga em ${x.joga_em_dias} dia(s)${x.classico ? ' ⚔ CLÁSSICO' : ''}`) +
      (x.procura_14d ? ` | ${x.procura_14d} leituras/14d${x.variacao_pct === null ? '' : ` (${x.variacao_pct > 0 ? '+' : ''}${x.variacao_pct}%)`}` : ' | sem procura medida'),
    ).join('\n'),
  );

  partes.push(`\n\nPRODUTOS QUE A CASA FABRICA: ${c.produtosDaCasa.join(', ')}.`);

  if (c.categorias.length) {
    partes.push(
      '\n\nO QUE A CONCORRÊNCIA TEM NA PRATELEIRA (catálogo público, preço em libra/dólar) — serve pra saber o que ' +
      'está lotado, o que está vazio e quanto o mercado cobra:\n' +
      c.categorias.slice(0, 12).map((x) =>
        `- ${x.tipo}: ${x.quantidade} itens, ${x.novos_45d} novos em 45d, preço médio ${x.preco_medio} (${x.preco_min}–${x.preco_max})`,
      ).join('\n'),
    );
  }

  if (c.falhas.length) partes.push(`\n\n(fontes com falha nesta rodada: ${c.falhas.join('; ')})`);
  return partes.join('');
}
