// Venda real de futebol, direto do datamart.
//
// POR QUE ISTO EXISTE, e vale ler antes de mexer: o agente de vendas passava as
// reuniões dizendo "sem dado". Não era burrice dele — era cegueira que EU
// causei. A fonte que eu tinha dado era o hub-futebol, cujo /api/summary puxa
// o Spree por um proxy que exige o cookie de sessão do NAVEGADOR
// (hub-futebol/src/index.ts:634). Uma chamada servidor-a-servidor não tem esse
// cookie: o HTTP responde 200, o corpo vem vazio, e o agente honestamente
// reportava que não tinha número. Enquanto isso o Palmeiras Uniforme 3 Selo
// vendia 871 unidades em 15 dias.
//
// Aqui a fonte é `silver.line_items` no Metabase (database 63) — o MESMO
// caminho que o Produtor já usa pra fila de pedidos e que funciona há semanas.
// Confirmado ao vivo (14/09/2026): a tabela tem dado do próprio dia, 491 mil
// itens nos últimos 7 dias, com quantidade, preço pago e custo.
//
// Por que 7d contra 7d e não 15/90: o ciclo de decisão desta mesa é de horas, e
// a pergunta útil é "o que mudou na semana", não "o que aconteceu no trimestre".

import type { Env } from '../aiproxy';
import { REGEX_CLUBES_LICENCIADOS } from './clubesLicenciados';

const METABASE_URL = 'https://metabase.gocase.com.br/api/dataset';
const DATABASE_ID_SILVER = 63;

// A regex de clube sem o "|futebol" solto do fim: aqui ela roda contra o NOME
// DO PRODUTO, e "futebol" cru traria acessório genérico que polui o ranking.
const REGEX_CLUBES = REGEX_CLUBES_LICENCIADOS.replace(/\|futebol$/, '');

const SQL = `
SELECT
  li.product_name,
  SUM(CASE WHEN li.item_created_at >= current_date - 7 THEN li.item_quantity ELSE 0 END) AS un_7d,
  SUM(CASE WHEN li.item_created_at >= current_date - 14 AND li.item_created_at < current_date - 7 THEN li.item_quantity ELSE 0 END) AS un_7d_ant,
  ROUND(SUM(CASE WHEN li.item_created_at >= current_date - 7 THEN COALESCE(li.item_discount_price, li.item_price) ELSE 0 END)::numeric, 0) AS receita_7d,
  ROUND(SUM(CASE WHEN li.item_created_at >= current_date - 14 AND li.item_created_at < current_date - 7 THEN COALESCE(li.item_discount_price, li.item_price) ELSE 0 END)::numeric, 0) AS receita_7d_ant
FROM silver.line_items li
WHERE li.item_created_at >= current_date - 14
  AND li.product_name ~* '${REGEX_CLUBES}'
GROUP BY li.product_name
HAVING SUM(CASE WHEN li.item_created_at >= current_date - 7 THEN li.item_quantity ELSE 0 END) > 0
ORDER BY un_7d DESC
LIMIT 40
`;

export interface ProdutoVendido {
  produto: string;
  un_7d: number;
  un_semana_passada: number;
  receita_7d: number;
  receita_semana_passada: number;
  variacao_un_pct: number | null;
}

export interface VendasResultado {
  ok: boolean;
  erro?: string;
  janela: string;
  total_un_7d: number;
  total_receita_7d: number;
  total_un_semana_passada: number;
  acelerando: ProdutoVendido[];
  esfriando: ProdutoVendido[];
  ranking: ProdutoVendido[];
}

const vazio = (erro: string): VendasResultado => ({
  ok: false, erro, janela: '', total_un_7d: 0, total_receita_7d: 0,
  total_un_semana_passada: 0, acelerando: [], esfriando: [], ranking: [],
});

export async function buscarVendasFutebol(env: Env): Promise<VendasResultado> {
  if (!env.METABASE_API_KEY) return vazio('Falta o METABASE_API_KEY deste app (setAppSecret).');

  try {
    const res = await fetch(METABASE_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.METABASE_API_KEY, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ type: 'native', native: { query: SQL }, database: DATABASE_ID_SILVER }),
    });
    if (!res.ok) return vazio(`Metabase HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const corpo = await res.json() as { data?: { rows?: unknown[][] } };
    const linhas = corpo.data?.rows || [];
    if (!linhas.length) return vazio('a consulta rodou mas não voltou nenhum produto de futebol vendido nos últimos 7 dias');

    // Ordem fixa do SELECT: product_name, un_7d, un_7d_ant, receita_7d, receita_7d_ant.
    const produtos: ProdutoVendido[] = linhas.map((r) => {
      const un7 = Number(r[1] ?? 0);
      const unAnt = Number(r[2] ?? 0);
      return {
        produto: String(r[0] ?? '').trim(),
        un_7d: un7,
        un_semana_passada: unAnt,
        receita_7d: Number(r[3] ?? 0),
        receita_semana_passada: Number(r[4] ?? 0),
        // Sem base na semana anterior não existe variação — é produto novo, e
        // inventar "+100%" aí seria mentira estatística.
        variacao_un_pct: unAnt > 0 ? Math.round(((un7 - unAnt) / unAnt) * 100) : null,
      };
    });

    const soma = (f: (p: ProdutoVendido) => number) => produtos.reduce((a, p) => a + f(p), 0);

    return {
      ok: true,
      janela: 'últimos 7 dias contra os 7 anteriores, até hoje',
      total_un_7d: soma((p) => p.un_7d),
      total_receita_7d: soma((p) => p.receita_7d),
      total_un_semana_passada: soma((p) => p.un_semana_passada),
      // Só entra em "acelerando" quem tem volume que justifica olhar: subir de
      // 2 pra 6 unidades é 200% e não significa nada.
      acelerando: produtos
        .filter((p) => p.un_7d >= 20 && p.variacao_un_pct !== null && p.variacao_un_pct >= 25)
        .sort((a, b) => (b.variacao_un_pct || 0) - (a.variacao_un_pct || 0)).slice(0, 6),
      esfriando: produtos
        .filter((p) => p.un_semana_passada >= 30 && p.variacao_un_pct !== null && p.variacao_un_pct <= -25)
        .sort((a, b) => (a.variacao_un_pct || 0) - (b.variacao_un_pct || 0)).slice(0, 6),
      ranking: produtos.slice(0, 15),
    };
  } catch (e) {
    return vazio('Falha ao consultar o Metabase: ' + ((e as Error)?.message || String(e)));
  }
}
