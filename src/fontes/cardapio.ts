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

/** CASE WHEN gigante que transforma nome de produto em nome de clube. Não existe coluna de clube. */
const CASE_CLUBE =
  'CASE ' + CLUBES.map((c) => `WHEN li.product_name ~* '${c.regex}' THEN '${c.nome.replace(/'/g, "''")}'`).join(' ') +
  " ELSE 'outro' END";

export interface LinhaClube {
  clube: string; un_30d: number; un_30d_ant: number; receita_30d: number; variacao_pct: number | null;
}
export interface LinhaFamilia { familia: string; tipo: string; un_30d: number; receita_30d: number }
export interface LinhaLancamento {
  produto: string; estreia: string; dias_no_ar: number; un_total: number; un_por_dia: number; un_7d: number;
}

export interface Cardapio {
  ok: boolean;
  clubes: LinhaClube[];
  familias: LinhaFamilia[];
  lancamentos: LinhaLancamento[];
  jogos: unknown;
  falhas: string[];
  /** Os nomes que uma recomendação pode citar. É o gabarito do juiz. */
  nomesDeClube: string[];
  nomesDeFamilia: string[];
}

const SQL_CLUBES = `
SELECT ${CASE_CLUBE} AS clube,
  SUM(CASE WHEN li.item_created_at >= current_date - 30 THEN li.item_quantity ELSE 0 END) AS un_30d,
  SUM(CASE WHEN li.item_created_at >= current_date - 60 AND li.item_created_at < current_date - 30 THEN li.item_quantity ELSE 0 END) AS un_30d_ant,
  ROUND(SUM(CASE WHEN li.item_created_at >= current_date - 30 THEN COALESCE(li.item_discount_price, li.item_price) ELSE 0 END)::numeric, 0) AS receita_30d
FROM silver.line_items li
WHERE li.item_created_at >= current_date - 60
  AND li.product_name ~* '${REGEX_FUTEBOL}'
GROUP BY 1
HAVING SUM(CASE WHEN li.item_created_at >= current_date - 30 THEN li.item_quantity ELSE 0 END) > 0
ORDER BY un_30d DESC
LIMIT 25
`;

const SQL_FAMILIAS = `
SELECT COALESCE(li.familia, 'sem familia') AS familia,
  COALESCE(li.tipo, 'sem tipo') AS tipo,
  SUM(li.item_quantity) AS un_30d,
  ROUND(SUM(COALESCE(li.item_discount_price, li.item_price))::numeric, 0) AS receita_30d
FROM silver.line_items li
WHERE li.item_created_at >= current_date - 30
  AND li.product_name ~* '${REGEX_FUTEBOL}'
GROUP BY 1, 2
ORDER BY un_30d DESC
LIMIT 20
`;

// O que a casa colocou no ar recentemente. "Estreia" é a primeira venda dentro
// da janela de 180 dias — produto antigo que voltou a vender aparece como
// estreante, e por isso a janela é longa o bastante pra isso ser raro.
const SQL_LANCAMENTOS = `
WITH por_produto AS (
  SELECT li.product_name,
    MIN(li.item_created_at) AS estreia,
    SUM(li.item_quantity) AS un_total,
    SUM(CASE WHEN li.item_created_at >= current_date - 7 THEN li.item_quantity ELSE 0 END) AS un_7d
  FROM silver.line_items li
  WHERE li.item_created_at >= current_date - 180
    AND li.product_name ~* '${REGEX_FUTEBOL}'
  GROUP BY 1
)
SELECT product_name, estreia::date AS estreia,
  (current_date - estreia::date) AS dias_no_ar,
  un_total, un_7d,
  ROUND(un_total::numeric / GREATEST(1, current_date - estreia::date), 1) AS un_por_dia
FROM por_produto
WHERE estreia >= current_date - 45
ORDER BY un_total DESC
LIMIT 20
`;

function linhas(c: Consulta): unknown[][] {
  return c.ok ? c.linhas : [];
}

/**
  * `jaColetado` evita a segunda varredura do calendário: a reunião já busca o
  * mundo (src/web/mundo.ts) e cada rodada do globoesporte é uma requisição
  * externa. Buscar duas vezes a mesma tabela é gasto puro de subrequest — e o
  * Worker tem teto disso.
  */
export async function montarCardapio(env: Env, jaColetado?: Calendario): Promise<Cardapio> {
  const [clubesQ, familiasQ, lancamentosQ, calendario] = await Promise.all([
    executarConsulta(env, SQL_CLUBES),
    executarConsulta(env, SQL_FAMILIAS),
    executarConsulta(env, SQL_LANCAMENTOS),
    jaColetado ? Promise.resolve(jaColetado) : buscarCalendario(14),
  ]);

  const falhas: string[] = [];
  if (!clubesQ.ok) falhas.push(`clubes: ${clubesQ.erro}`);
  if (!familiasQ.ok) falhas.push(`familias: ${familiasQ.erro}`);
  if (!lancamentosQ.ok) falhas.push(`lancamentos: ${lancamentosQ.erro}`);
  if (!calendario.ok) falhas.push(`calendario: ${calendario.erro}`);

  const clubes: LinhaClube[] = linhas(clubesQ)
    .map((r) => {
      const un = Number(r[1] ?? 0), ant = Number(r[2] ?? 0);
      return {
        clube: String(r[0] ?? ''), un_30d: un, un_30d_ant: ant, receita_30d: Number(r[3] ?? 0),
        variacao_pct: ant > 0 ? Math.round(((un - ant) / ant) * 100) : null,
      };
    })
    .filter((c) => c.clube && c.clube !== 'outro');

  const familias: LinhaFamilia[] = linhas(familiasQ).map((r) => ({
    familia: String(r[0] ?? ''), tipo: String(r[1] ?? ''),
    un_30d: Number(r[2] ?? 0), receita_30d: Number(r[3] ?? 0),
  }));

  const lancamentos: LinhaLancamento[] = linhas(lancamentosQ).map((r) => ({
    produto: String(r[0] ?? '').trim(), estreia: String(r[1] ?? ''),
    dias_no_ar: Number(r[2] ?? 0), un_total: Number(r[3] ?? 0),
    un_7d: Number(r[4] ?? 0), un_por_dia: Number(r[5] ?? 0),
  }));

  return {
    ok: clubes.length > 0 || familias.length > 0,
    clubes, familias, lancamentos,
    jogos: calendario.proximos,
    falhas,
    nomesDeClube: clubes.map((c) => c.clube),
    nomesDeFamilia: [...new Set(familias.flatMap((f) => [f.familia, f.tipo]))].filter((x) => x && !/^sem /.test(x)),
  };
}

/**
 * O cardápio em texto, do jeito que entra no prompt. É deliberadamente uma
 * LISTA DE OPÇÕES e não um relatório: a mesa tem que sentir que está
 * escolhendo entre coisas que existem, não redigindo uma análise.
 */
export function formatarCardapio(c: Cardapio): string {
  if (!c.ok) {
    return 'O CARDÁPIO NÃO CARREGOU nesta rodada' +
      (c.falhas.length ? ` (${c.falhas.join('; ')})` : '') +
      '. Sem ele você NÃO tem como recomendar nada com nome próprio — então diga isso com todas as letras ' +
      'em vez de inventar uma recomendação genérica pra preencher espaço.';
  }

  const partes: string[] = ['━━ O QUE A CASA TEM NA MÃO AGORA (escolha daqui; não invente fora daqui) ━━'];

  if (c.clubes.length) {
    partes.push(
      '\nCLUBES, por venda dos últimos 30 dias (un | receita | variação contra os 30 anteriores):\n' +
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
