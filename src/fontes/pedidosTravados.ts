// Fiscal de Pedidos Travados — mesma fonte de dado do dashboard da Giovanna
// (app pedidostravadosilustra, Metabase database_id 63/3), SEM tocar no app
// dela: aqui é uma query própria, com secret próprio (METABASE_API_KEY deste
// app), filtrada só à fatia de futebol. A regex de clubes/CBF é a MESMA que
// o dashboard dela já usa e validou — não foi reinventada.

import type { Env } from '../aiproxy';
import { REGEX_CLUBES_LICENCIADOS as REGEX_FUTEBOL } from './clubesLicenciados';

const METABASE_URL = 'https://metabase.gocase.com.br/api/dataset';
const DATABASE_ID_SILVER = 63;
const DATABASE_ID_PROD = 3;

// Mesma lógica de dedup + checagem de "ainda travado de verdade" do app da
// Giovanna, com WHERE pedido_futebol no final — só a fatia que importa aqui.
const SQL_PEDIDOS_FUTEBOL_TRAVADOS = `
WITH dedup AS (
  SELECT DISTINCT ON (lr.factory_order_id)
      o.order_number                      AS order_number,
      lr.factory_order_id                 AS factory_order_id,
      o.locked                            AS locked_raw,
      lr.primeiro_motivo_travamento       AS motivo_primeiro,
      lr.motivo_atualizado_travamento     AS motivo_atual,
      lr.motivo_atualizado_tag            AS tag_atual,
      lr.primeiro_travamento_em           AS travado_em,
      lr.ultimo_travamento_em             AS ultimo_travamento_em,
      lr.ultimo_destravamento_em          AS ultimo_destravamento_em_raw,
      o.total_price                       AS valor_total,
      (
        EXISTS (
          SELECT 1 FROM silver.line_items li
          WHERE li.order_number = o.order_number
            AND li.product_name ~* '${REGEX_FUTEBOL}'
        )
        OR lr.primeiro_motivo_travamento ~* '${REGEX_FUTEBOL}'
        OR lr.motivo_atualizado_travamento ~* '${REGEX_FUTEBOL}'
      ) AS pedido_futebol
  FROM silver.order_lock_reasons lr
  LEFT JOIN silver.orders o
      ON o.factory_order_id = lr.factory_order_id
  WHERE lr.primeiro_travamento_em >= current_date - interval '120 days'
    AND (lr.motivo_atualizado_tag IN ('IL', 'Cadastro') OR lr.primeiro_motivo_tag IN ('IL', 'Cadastro'))
  ORDER BY lr.factory_order_id, lr.updated_at DESC NULLS LAST
)
SELECT
    order_number, travado_em, motivo_atual, tag_atual, valor_total,
    (locked_raw AND (ultimo_destravamento_em_raw IS NULL OR ultimo_destravamento_em_raw <= ultimo_travamento_em))
        AS atualmente_travado
FROM dedup
WHERE pedido_futebol
ORDER BY travado_em ASC
`;

// Corpo e cabeçalho no formato exato já validado em produção pelo app da
// Giovanna (fetchStillLockedSet em pedidostravadosilustra/src/server.ts):
// "x-api-key", sem template_tags/parameters, rows posicionais (array de
// arrays, não objetos) — por isso o SELECT abaixo tem ordem de coluna fixa.
async function consultarMetabase(apiKey: string, databaseId: number, sql: string): Promise<unknown[][]> {
  const res = await fetch(METABASE_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ type: 'native', native: { query: sql }, database: databaseId }),
  });
  if (!res.ok) throw new Error(`Metabase HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const corpo = await res.json() as { data?: { rows?: unknown[][] } };
  return corpo.data?.rows || [];
}

export interface PedidoTravado {
  order_number: string;
  travado_em: string;
  motivo_atual: string;
  tag_atual: string;
  valor_total: number;
  atualmente_travado: boolean;
}

export interface FilaTravadosResultado {
  ok: boolean;
  pedidos: (PedidoTravado & { dias_travado: number })[];
  erro?: string;
}

export async function buscarPedidosFutebolTravados(env: Env): Promise<FilaTravadosResultado> {
  if (!env.METABASE_API_KEY) {
    return { ok: false, pedidos: [], erro: 'Falta o METABASE_API_KEY deste app (setAppSecret). Gere uma chave própria no Metabase — não reusa a da Giovanna.' };
  }
  try {
    const linhasRaw = await consultarMetabase(env.METABASE_API_KEY, DATABASE_ID_SILVER, SQL_PEDIDOS_FUTEBOL_TRAVADOS);
    // Ordem de coluna fixa no SELECT: order_number, travado_em, motivo_atual, tag_atual, valor_total, atualmente_travado.
    const linhas: PedidoTravado[] = linhasRaw.map((r) => ({
      order_number: String(r[0]), travado_em: String(r[1]), motivo_atual: String(r[2] ?? ''),
      tag_atual: String(r[3] ?? ''), valor_total: Number(r[4] ?? 0), atualmente_travado: Boolean(r[5]),
    }));
    const candidatos = linhas.filter((l) => l.atualmente_travado);

    // A réplica "silver" atrasa em relação à produção — confirma no banco 3
    // quais desses ainda estão travados de verdade, como o app da Giovanna faz.
    // Se a checagem falhar, mantém todos como travados: melhor mostrar um
    // pedido já resolvido por engano do que esconder um travado de fato.
    let aindaTravados = new Set(candidatos.map((c) => c.order_number));
    if (candidatos.length) {
      try {
        const nums = candidatos.map((c) => `'${c.order_number.replace(/'/g, "''")}'`).join(', ');
        const check = await consultarMetabase(
          env.METABASE_API_KEY, DATABASE_ID_PROD,
          `SELECT o.reference AS order_number FROM orders o WHERE o.reference IN (${nums}) AND o.locked = true AND o.aasm_state NOT IN ('canceled', 'delivered')`,
        );
        aindaTravados = new Set(check.map((r) => String(r[0])));
      } catch {
        // mantém o fallback conservador definido acima
      }
    }

    const agora = Date.now();
    const pedidos = candidatos
      .filter((c) => aindaTravados.has(c.order_number))
      .map((c) => ({
        ...c,
        dias_travado: Math.max(0, Math.floor((agora - new Date(c.travado_em).getTime()) / 86400000)),
      }));

    return { ok: true, pedidos };
  } catch (e) {
    return { ok: false, pedidos: [], erro: (e as Error)?.message || String(e) };
  }
}
