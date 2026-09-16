// O CARDÁPIO: o que a casa pode de fato fazer, com nome próprio.
//
// POR QUE ISTO EXISTE (João, 16/09/2026): "recomendação genérica" e "assunto
// irrelevante". As duas queixas têm a mesma raiz — a mesa só enxergava o
// mercado em abstrato (uma curva de venda, uma manchete) e nunca o QUE A CASA
// TEM NA MÃO. Sem saber quais clubes vendem, que famílias de produto existem,
// o que foi lançado nas últimas semanas e que jogo vem aí, o melhor que um
// modelo consegue escrever é "explorar o nicho nordestino" — que serve pra
// qualquer semana e por isso não serve pra nenhuma.
//
// O cardápio é o conjunto de opções REAIS da rodada. A mesa não inventa o que
// fazer: ela ESCOLHE daqui, e a escolha é conferível (ver src/juiz.ts — uma
// recomendação que não cita clube e família deste cardápio é reprovada antes
// de chegar ao João).
//
// Três consultas curtas em vez de uma grande: cada uma tem seu próprio timeout
// de 40s no Metabase, e uma que falhe não leva as outras junto.

import type { Env } from '../aiproxy';
import { executarConsulta, formatarResultado, type Consulta } from '../consulta';
import { buscarCalendario, type Calendario } from '../web/calendario';

/** Os clubes licenciados, com o nome como a casa escreve e o padrão que acha no produto. */
export const CLUBES: { nome: string; regex: string }[] = [
  { nome: 'Flamengo', regex: 'flamengo' },
  { nome: 'Corinthians', regex: 'corinthians' },
  { nome: 'Palmeiras', regex: 'palmeiras' },
  { nome: 'Vasco', regex: 'vasco' },
  { nome: 'Botafogo', regex: 'botafogo' },
  { nome: 'Fluminense', regex: 'fluminense' },
  { nome: 'São Paulo', regex: 's[ãa]o paulo' },
  { nome: 'Internacional', regex: 'internacional' },
  { nome: 'Grêmio', regex: 'gr[êe]mio' },
  { nome: 'Vitória', regex: 'vit[óo]ria' },
  { nome: 'Sport Recife', regex: 'sport recife' },
  { nome: 'Santos', regex: 'santos' },
  { nome: 'Fortaleza', regex: 'fortaleza' },
  { nome: 'Coritiba', regex: 'coritiba' },
  { nome: 'Cruzeiro', regex: 'cruzeiro' },
  { nome: 'Ceará', regex: 'cear[áa]' },
  { nome: 'Bahia', regex: 'bahia' },
  { nome: 'Atlético-MG', regex: 'atl[ée]tico' },
];

const REGEX_FUTEBOL = CLUBES.map((c) => c.regex).join('|');

export interface LinhaClube {
  clube: string; un_30d: number; un_30d_ant: number; receita_30d: number; variacao_pct: number | null;
}
export interface LinhaFamilia { familia: string; tipo: string; un_30d: number; receita_30d: number }
export interface LinhaLancamento {
  produto: string; estreia: string; dias_no_ar: number; un_total: number; un_por_dia: number; un_7d: number;
}

export interface Cardapio {
  ok: boolean;
  /** true quando a venda não veio e o cardápio foi montado só com o calendário. */
  semVenda: boolean;
  clubes: LinhaClube[];
  familias: LinhaFamilia[];
  lancamentos: LinhaLancamento[];
  jogos: unknown;
  falhas: string[];
  nomesDeClube: string[];
  nomesDeFamilia: string[];
}

// UMA consulta, 35 dias, agregada por produto — e o resto é feito em
// JavaScript.
//
// POR QUE MUDOU (João, 16/09/2026: "o cardápio cortou após 40 segundos"): a
// versão anterior fazia TRÊS consultas, uma delas varrendo 180 dias, e a de
// clubes rodava um CASE com 18 expressões regulares POR LINHA sobre 60 dias de
// itens. Estourava o timeout — e, como o juiz exige clube do cardápio, a mesa
// ficava sem poder recomendar qualquer coisa e devolvia "não há o que
// recomendar" todo dia. O usuário recebeu a mesma resposta vazia por dias por
// causa desta query.
//
// Agora: um filtro regex só (no WHERE, que o Postgres aplica uma vez por
// linha), janela de 35 dias, agrupamento por produto. Quem é de qual clube e o
// que é família é decidido aqui no código, sobre ~200 linhas — trabalho de
// milissegundos fora do banco.
const SQL_CARDAPIO = `
SELECT li.product_name,
  COALESCE(li.familia, 'sem familia') AS familia,
  COALESCE(li.tipo, 'sem tipo') AS tipo,
  MIN(li.item_created_at)::date AS estreia,
  SUM(CASE WHEN li.item_created_at >= current_date - 30 THEN li.item_quantity ELSE 0 END) AS un_30d,
  SUM(CASE WHEN li.item_created_at >= current_date - 35 AND li.item_created_at < current_date - 30 THEN li.item_quantity ELSE 0 END) AS un_5d_ant,
  SUM(CASE WHEN li.item_created_at >= current_date - 7 THEN li.item_quantity ELSE 0 END) AS un_7d,
  ROUND(SUM(CASE WHEN li.item_created_at >= current_date - 30 THEN COALESCE(li.item_discount_price, li.item_price) ELSE 0 END)::numeric, 0) AS receita_30d
FROM silver.line_items li
WHERE li.item_created_at >= current_date - 35
  AND li.product_name ~* '${REGEX_FUTEBOL}'
GROUP BY 1, 2, 3
ORDER BY un_30d DESC
LIMIT 200
`;

interface LinhaProduto {
  produto: string; familia: string; tipo: string; estreia: string;
  un_30d: number; un_7d: number; receita_30d: number;
}

function clubeDoProduto(nome: string): string | null {
  for (const c of CLUBES) {
    if (new RegExp(c.regex, 'i').test(nome)) return c.nome;
  }
  return null;
}

/** Sem venda nenhuma, o cardápio ainda existe: quem joga na janela e o que a casa fabrica. */
function cardapioSoDoCalendario(calendario: Calendario, falhas: string[]): Cardapio {
  const clubes = [...new Set(calendario.proximos.flatMap((j) => [j.mandante, j.visitante]))];
  return {
    ok: clubes.length > 0,
    semVenda: true,
    clubes: [], familias: [], lancamentos: [],
    jogos: calendario.proximos,
    falhas,
    nomesDeClube: clubes,
    nomesDeFamilia: ['capinha', 'térmico', 'caneca', 'camiseta', 'copo', 'garrafa', 'mochila', 'almofada', 'adesivo', 'chaveiro'],
  };
}

/**
 * `jaColetado` evita a segunda varredura do calendário: a reunião já busca o
 * mundo (src/web/mundo.ts) e cada rodada do globoesporte é uma requisição
 * externa. Buscar duas vezes a mesma tabela é gasto puro de subrequest.
 */
export async function montarCardapio(env: Env, jaColetado?: Calendario): Promise<Cardapio> {
  const [produtosQ, calendario] = await Promise.all([
    executarConsulta(env, SQL_CARDAPIO),
    jaColetado ? Promise.resolve(jaColetado) : buscarCalendario(14),
  ]);

  const falhas: string[] = [];
  if (!produtosQ.ok) falhas.push(`venda: ${produtosQ.erro}`);
  if (!calendario.ok) falhas.push(`calendario: ${calendario.erro}`);

  // A venda caiu: em vez de deixar a mesa sem cardápio (e portanto sem poder
  // recomendar nada, que foi o que aconteceu), monta com o que a internet deu.
  if (!produtosQ.ok || !produtosQ.linhas.length) {
    return cardapioSoDoCalendario(calendario, falhas.length ? falhas : ['venda: sem linhas']);
  }

  // Ordem fixa do SELECT: product_name, familia, tipo, estreia, un_30d, un_5d_ant, un_7d, receita_30d.
  const produtos: LinhaProduto[] = produtosQ.linhas.map((r) => ({
    produto: String(r[0] ?? '').trim(),
    familia: String(r[1] ?? ''),
    tipo: String(r[2] ?? ''),
    estreia: String(r[3] ?? '').slice(0, 10),
    un_30d: Number(r[4] ?? 0),
    un_7d: Number(r[6] ?? 0),
    receita_30d: Number(r[7] ?? 0),
  }));

  // ── clubes: agregação em JS, não no banco ──
  const porClube = new Map<string, { un: number; receita: number }>();
  for (const p of produtos) {
    const clube = clubeDoProduto(p.produto);
    if (!clube) continue;
    const atual = porClube.get(clube) || { un: 0, receita: 0 };
    porClube.set(clube, { un: atual.un + p.un_30d, receita: atual.receita + p.receita_30d });
  }
  const clubes: LinhaClube[] = [...porClube.entries()]
    .map(([clube, v]) => ({ clube, un_30d: v.un, un_30d_ant: 0, receita_30d: v.receita, variacao_pct: null }))
    .filter((c) => c.un_30d > 0)
    .sort((a, b) => b.un_30d - a.un_30d);

  // ── famílias ──
  const porFamilia = new Map<string, { un: number; receita: number }>();
  for (const p of produtos) {
    const chave = `${p.familia}||${p.tipo}`;
    const atual = porFamilia.get(chave) || { un: 0, receita: 0 };
    porFamilia.set(chave, { un: atual.un + p.un_30d, receita: atual.receita + p.receita_30d });
  }
  const familias: LinhaFamilia[] = [...porFamilia.entries()]
    .map(([chave, v]) => ({ familia: chave.split('||')[0], tipo: chave.split('||')[1], un_30d: v.un, receita_30d: v.receita }))
    .filter((f) => f.un_30d > 0)
    .sort((a, b) => b.un_30d - a.un_30d)
    .slice(0, 14);

  // ── lançamentos: estreia dentro da janela consultada ──
  const hoje = Date.now();
  const lancamentos: LinhaLancamento[] = produtos
    .filter((p) => p.estreia && (hoje - new Date(`${p.estreia}T12:00:00Z`).getTime()) / 86400000 <= 30)
    .map((p) => {
      const dias = Math.max(1, Math.round((hoje - new Date(`${p.estreia}T12:00:00Z`).getTime()) / 86400000));
      return {
        produto: p.produto, estreia: p.estreia, dias_no_ar: dias,
        un_total: p.un_30d, un_7d: p.un_7d,
        un_por_dia: Math.round((p.un_30d / dias) * 10) / 10,
      };
    })
    .sort((a, b) => b.un_total - a.un_total)
    .slice(0, 12);

  return {
    ok: true,
    semVenda: false,
    clubes, familias, lancamentos,
    jogos: calendario.proximos,
    falhas,
    // Os clubes que a mesa pode citar: quem vende E quem entra em campo. Sem a
    // segunda metade, um clube que joga clássico no domingo mas vendeu pouco no
    // mês ficava proibido de ser recomendado — exatamente ao contrário do útil.
    nomesDeClube: [...new Set([
      ...clubes.map((c) => c.clube),
      ...calendario.proximos.flatMap((j) => [j.mandante, j.visitante]),
    ])],
    nomesDeFamilia: [...new Set(familias.flatMap((f) => [f.familia, f.tipo]))].filter((x) => x && !/^sem /.test(x)),
  };
}

/**
 * O cardápio em texto, do jeito que entra no prompt. É deliberadamente uma
 * LISTA DE OPÇÕES e não um relatório: a mesa tem que sentir que está
 * escolhendo entre coisas que existem, não redigindo uma análise.
 */
export function formatarCardapio(c: Cardapio): string {
  if (c.semVenda && c.ok) {
    const jogos = (c.jogos as { mandante: string; visitante: string; data: string | null; em_dias: number | null; classico: boolean }[]) || [];
    return (
      '━━ O QUE A CASA TEM NA MÃO AGORA ━━\n' +
      '⚠ A consulta de venda não voltou nesta rodada' + (c.falhas.length ? ` (${c.falhas.join('; ')})` : '') + '. ' +
      'Isso NÃO é licença pra não recomendar nada: você continua tendo o calendário e tudo que veio da internet. ' +
      'O que muda é a evidência que você cita — em vez do número de venda, use a procura, a notícia ou o jogo, ' +
      'e diga na recomendação que o número de venda não estava disponível.\n\n' +
      'CLUBES QUE ENTRAM EM CAMPO NA JANELA (pode recomendar qualquer um destes):\n' +
      jogos.slice(0, 12).map((j) =>
        `- ${j.mandante} x ${j.visitante}${j.data ? ` em ${j.data}` : ''}` +
        (j.em_dias !== null ? ` (daqui a ${j.em_dias} dias)` : '') + (j.classico ? ' ⚔ CLÁSSICO' : ''),
      ).join('\n') +
      '\n\nPRODUTOS QUE A CASA FABRICA: ' + c.nomesDeFamilia.join(', ') + '.'
    );
  }

  if (!c.ok) {
    return 'O CARDÁPIO NÃO CARREGOU nesta rodada' +
      (c.falhas.length ? ` (${c.falhas.join('; ')})` : '') +
      '. Sem ele você NÃO tem como recomendar nada com nome próprio — então diga isso com todas as letras ' +
      'em vez de inventar uma recomendação genérica pra preencher espaço.';
  }

  const partes: string[] = ['━━ O QUE A CASA TEM NA MÃO AGORA (escolha daqui; não invente fora daqui) ━━'];

  if (c.clubes.length) {
    partes.push(
      '\nCLUBES, por venda dos últimos 30 dias (un | receita | variação da última semana contra a anterior):\n' +
      c.clubes.slice(0, 14).map((x) =>
        `- ${x.clube}: ${x.un_30d} un | R$ ${x.receita_30d}` +
        (x.variacao_pct === null ? ' | sem base anterior' : ` | ${x.variacao_pct > 0 ? '+' : ''}${x.variacao_pct}%`),
      ).join('\n'),
    );
  }

  if (c.familias.length) {
    partes.push(
      '\nFAMÍLIAS E TIPOS DE PRODUTO que vendem em futebol (30 dias):\n' +
      c.familias.slice(0, 12).map((x) => `- ${x.familia} / ${x.tipo}: ${x.un_30d} un | R$ ${x.receita_30d}`).join('\n'),
    );
  }

  if (c.lancamentos.length) {
    partes.push(
      '\nO QUE A CASA LANÇOU nos últimos 45 dias (e como foi) — isto é o trabalho de vocês em campo:\n' +
      c.lancamentos.slice(0, 12).map((x) =>
        `- ${x.produto} | estreou ${x.estreia} (${x.dias_no_ar}d no ar) | ${x.un_total} un no total, ${x.un_por_dia}/dia, ${x.un_7d} na última semana`,
      ).join('\n'),
    );
  } else {
    partes.push('\nLANÇAMENTOS: nada estreou nos últimos 45 dias. Isso por si só é um fato sobre a área.');
  }

  const jogos = (c.jogos as { mandante: string; visitante: string; data: string | null; em_dias: number | null; classico: boolean }[]) || [];
  if (jogos.length) {
    partes.push(
      '\nJOGOS QUE VÊM AÍ (calendário real do globoesporte — é a janela em que dá pra produzir e vender):\n' +
      jogos.slice(0, 12).map((j) =>
        `- ${j.mandante} x ${j.visitante}${j.data ? ` em ${j.data}` : ''}` +
        (j.em_dias !== null ? ` (daqui a ${j.em_dias} dias)` : '') + (j.classico ? ' ⚔ CLÁSSICO' : ''),
      ).join('\n'),
    );
  }

  if (c.falhas.length) partes.push(`\n(fontes com falha nesta rodada: ${c.falhas.join('; ')})`);

  return partes.join('\n');
}

export { formatarResultado };
