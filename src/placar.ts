// O PLACAR: o que aconteceu com o que a mesa recomendou da última vez.
//
// Isto é o que faltava pra mesa deixar de ser opinião recorrente e virar
// trabalho. Até aqui ela recomendava e ninguém nunca voltava pra ver no que
// deu — então nada a corrigia: uma recomendação ruim custava exatamente o
// mesmo que uma boa, e por isso não havia pressão nenhuma pra ser específica.
//
// Agora toda reunião ABRE prestando contas da anterior, com número do banco e
// não com memória do modelo: a recomendação citava um clube (o juiz obriga),
// então dá pra medir o que aquele clube vendeu desde então contra a janela
// equivalente anterior.
//
// O que isto NÃO é: prova de causalidade. Se o Ceará subiu depois da
// recomendação, pode ter sido o clássico, e não a mesa. O texto abaixo diz
// isso na cara em vez de fingir um mérito que não dá pra provar — é o tipo de
// número que a Rafa recusaria se viesse embrulhado como vitória.

import type { Env } from './aiproxy';
import { executarConsulta } from './consulta';
import { CLUBES } from './fontes/cardapio';
import { normalizar } from './juiz';

export interface RecomendacaoMedida {
  o_que: string;
  quando: string;
  clube: string | null;
  un_depois: number | null;
  un_antes: number | null;
  variacao_pct: number | null;
}

export interface Placar {
  houve: boolean;
  dias: number;
  medidas: RecomendacaoMedida[];
  erro?: string;
}

/** Acha o clube citado no texto da recomendação. É o que torna a medição possível. */
export function clubeCitado(texto: string): string | null {
  const t = normalizar(texto);
  for (const c of CLUBES) {
    // O regex do cardápio já cobre grafia com e sem acento.
    if (new RegExp(normalizar(c.regex), 'i').test(t)) return c.nome;
  }
  return null;
}

/**
 * Mede as recomendações da ata anterior. Uma consulta só, agregando por clube
 * nas duas janelas — a de depois da recomendação e a de mesmo tamanho antes.
 */
export async function medirRecomendacoesAnteriores(env: Env): Promise<Placar> {
  const q = await env.DB.query(
    "SELECT quando, recomendacoes FROM atas WHERE recomendacoes IS NOT NULL AND recomendacoes != '[]' ORDER BY quando DESC LIMIT 1",
    [],
  );
  const linha = q.rows[0];
  if (!linha) return { houve: false, dias: 0, medidas: [] };

  let recs: { o_que?: string }[] = [];
  try { recs = JSON.parse(String(linha.recomendacoes || '[]')); } catch { recs = []; }
  if (!recs.length) return { houve: false, dias: 0, medidas: [] };

  const quando = String(linha.quando || '');
  const dias = Math.max(1, Math.round((Date.now() - new Date(quando).getTime()) / 86400000));
  // Janela curta demais não mede nada: menos de um dia inteiro, a resposta
  // honesta é "ainda não dá pra saber".
  if (dias < 1) {
    return { houve: true, dias, medidas: recs.map((r) => ({
      o_que: String(r.o_que || ''), quando, clube: clubeCitado(String(r.o_que || '')),
      un_depois: null, un_antes: null, variacao_pct: null,
    })) };
  }

  const clubes = [...new Set(recs.map((r) => clubeCitado(String(r.o_que || ''))).filter(Boolean))] as string[];
  if (!clubes.length) {
    return { houve: true, dias, medidas: recs.map((r) => ({
      o_que: String(r.o_que || ''), quando, clube: null, un_depois: null, un_antes: null, variacao_pct: null,
    })) };
  }

  const regexPorNome = new Map(CLUBES.map((c) => [c.nome, c.regex]));
  const caseClube = 'CASE ' + clubes
    .map((n) => `WHEN li.product_name ~* '${regexPorNome.get(n)}' THEN '${n.replace(/'/g, "''")}'`)
    .join(' ') + " ELSE 'outro' END";

  const sql = `
SELECT ${caseClube} AS clube,
  SUM(CASE WHEN li.item_created_at >= current_date - ${dias} THEN li.item_quantity ELSE 0 END) AS un_depois,
  SUM(CASE WHEN li.item_created_at >= current_date - ${dias * 2} AND li.item_created_at < current_date - ${dias} THEN li.item_quantity ELSE 0 END) AS un_antes
FROM silver.line_items li
WHERE li.item_created_at >= current_date - ${dias * 2}
  AND li.product_name ~* '${clubes.map((n) => regexPorNome.get(n)).join('|')}'
GROUP BY 1
LIMIT 30`;

  const r = await executarConsulta(env, sql);
  if (!r.ok) {
    return {
      houve: true, dias, erro: r.erro,
      medidas: recs.map((x) => ({
        o_que: String(x.o_que || ''), quando, clube: clubeCitado(String(x.o_que || '')),
        un_depois: null, un_antes: null, variacao_pct: null,
      })),
    };
  }

  const porClube = new Map<string, { depois: number; antes: number }>();
  for (const l of r.linhas) {
    porClube.set(String(l[0]), { depois: Number(l[1] ?? 0), antes: Number(l[2] ?? 0) });
  }

  return {
    houve: true, dias,
    medidas: recs.map((x) => {
      const o_que = String(x.o_que || '');
      const clube = clubeCitado(o_que);
      const medida = clube ? porClube.get(clube) : undefined;
      const depois = medida?.depois ?? null;
      const antes = medida?.antes ?? null;
      return {
        o_que, quando, clube, un_depois: depois, un_antes: antes,
        variacao_pct: depois !== null && antes ? Math.round(((depois - antes) / antes) * 100) : null,
      };
    }),
  };
}

/** O texto que abre a reunião. Curto, e sem se dar medalha. */
export function formatarPlacar(p: Placar): string {
  if (!p.houve) {
    return 'PRESTAÇÃO DE CONTAS: esta é a primeira rodada com recomendação — não há nada da véspera pra cobrar ainda.';
  }
  const linhas = p.medidas.map((m) => {
    if (m.un_depois === null) {
      return `- "${m.o_que}" → não deu pra medir` +
        (m.clube ? ' (o número do clube não voltou)' : ' (a recomendação não citava clube, então não há o que medir)');
    }
    const variacao = m.variacao_pct === null
      ? 'sem base anterior pra comparar'
      : `${m.variacao_pct > 0 ? '+' : ''}${m.variacao_pct}% contra os ${p.dias} dia(s) anteriores`;
    return `- "${m.o_que}" → ${m.clube}: ${m.un_depois} un nos últimos ${p.dias} dia(s) (${variacao})`;
  }).join('\n');

  return (
    `PRESTAÇÃO DE CONTAS — o que a mesa recomendou na última reunião e o que aconteceu depois:\n${linhas}\n` +
    (p.erro ? `(a medição falhou: ${p.erro})\n` : '') +
    'ATENÇÃO AO LER ISTO: o número é do CLUBE inteiro, não da peça recomendada, e a variação pode ter vindo ' +
    'do jogo, da data ou de qualquer outra coisa. Não trate como prova de que a mesa acertou. O uso certo é ' +
    'outro: se algo que vocês empurraram não se mexeu, isso é motivo pra mudar de ideia hoje — e dizer que ' +
    'mudou.'
  );
}
