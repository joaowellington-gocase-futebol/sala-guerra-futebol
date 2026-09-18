// O PLACAR — o que aconteceu com o que a mesa recomendou da última vez.
//
// É o que impede a mesa de ser opinião recorrente: toda reunião ABRE prestando
// contas da anterior. Sem isso, uma recomendação ruim custa o mesmo que uma
// boa, e nada pressiona por qualidade.
//
// O QUE MUDOU EM 18/09/2026: a medição era feita na venda própria do datamart.
// Agora é feita na PROCURA — quantas pessoas foram ler sobre aquele clube nos
// 14 dias depois da recomendação, contra os 14 anteriores. É pública, é
// verificável no link, e mede o que a recomendação de fato apostou: que aquele
// clube ia puxar atenção.
//
// O que isto NÃO é: prova de que a casa vendeu. É a régua do acerto da leitura
// de mercado, não do caixa — e o texto abaixo diz isso na cara, em vez de
// fingir um mérito que não dá pra provar daqui.

import type { Env } from './aiproxy';
import { procuraDeUmClube, ARTIGO_DO_CLUBE } from './web/procura';
import { normalizar } from './juiz';

export interface RecomendacaoMedida {
  o_que: string;
  quando: string;
  clube: string | null;
  procura_depois: number | null;
  variacao_pct: number | null;
  link: string;
}

export interface Placar {
  houve: boolean;
  dias: number;
  medidas: RecomendacaoMedida[];
}

/** Acha o clube citado no texto da recomendação — é o que torna a medição possível. */
export function clubeCitado(texto: string): string | null {
  const t = normalizar(texto);
  for (const nome of Object.keys(ARTIGO_DO_CLUBE)) {
    if (t.includes(normalizar(nome))) return nome;
  }
  return null;
}

/**
 * Os clubes que a mesa já usou como tema nas últimas rodadas.
 *
 * POR QUE (João, 16/09/2026): "eles estão o tempo todo falando de Ceará e
 * Fortaleza, porque foi uma série de teste que eu fiz". Um agente não percebe
 * que está repetindo; o histórico percebe.
 */
export async function clubesJaBatidos(env: Env, quantasAtas = 5): Promise<string[]> {
  const q = await env.DB.query('SELECT tema, recomendacoes FROM atas ORDER BY quando DESC LIMIT ?', [quantasAtas]);
  const achados: string[] = [];
  for (const linha of q.rows) {
    let recs: { o_que?: string }[] = [];
    try { recs = JSON.parse(String(linha.recomendacoes || '[]')); } catch { recs = []; }
    for (const t of [String(linha.tema || ''), ...recs.map((r) => String(r.o_que || ''))]) {
      const c = clubeCitado(t);
      if (c) achados.push(c);
    }
  }
  const contagem = new Map<string, number>();
  for (const c of achados) contagem.set(c, (contagem.get(c) || 0) + 1);
  return [...contagem.entries()].filter(([, n]) => n >= 2).map(([c]) => c);
}

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

  // Uma série por clube citado, sem repetir clube.
  const clubes = [...new Set(recs.map((r) => clubeCitado(String(r.o_que || ''))).filter(Boolean))] as string[];
  const series = new Map<string, Awaited<ReturnType<typeof procuraDeUmClube>>>();
  for (const c of clubes.slice(0, 3)) series.set(c, await procuraDeUmClube(c));

  return {
    houve: true, dias,
    medidas: recs.map((r) => {
      const o_que = String(r.o_que || '');
      const clube = clubeCitado(o_que);
      const s = clube ? series.get(clube) : null;
      return {
        o_que, quando, clube,
        procura_depois: s?.views_14d ?? null,
        variacao_pct: s?.variacao_pct ?? null,
        link: s?.link || '',
      };
    }),
  };
}

export function formatarPlacar(p: Placar): string {
  if (!p.houve) {
    return 'PRESTAÇÃO DE CONTAS: esta é a primeira rodada com recomendação — não há nada da véspera pra cobrar ainda.';
  }
  const linhas = p.medidas.map((m) => {
    if (m.procura_depois === null) {
      return `- "${m.o_que.slice(0, 120)}" → sem medição` +
        (m.clube ? ' (a série de procura do clube não voltou)' : ' (a recomendação não citava clube, então não há o que medir)');
    }
    const v = m.variacao_pct === null ? 'sem base anterior' : `${m.variacao_pct > 0 ? '+' : ''}${m.variacao_pct}% em 14 dias`;
    return `- "${m.o_que.slice(0, 120)}" → ${m.clube}: ${m.procura_depois} leituras nos últimos 14d (${v}) · ${m.link}`;
  }).join('\n');

  return (
    `PRESTAÇÃO DE CONTAS — o que a mesa recomendou há ${p.dias} dia(s) e o que a PROCURA fez desde então:\n${linhas}\n` +
    'COMO LER ISTO: procura não é venda, e a variação pode ter vindo do jogo, da notícia ou de qualquer outra ' +
    'coisa. Não trate como prova de acerto. O uso certo é o contrário: se o clube que vocês empurraram nem se ' +
    'mexeu na atenção do público, isso é motivo pra mudar de ideia hoje — e dizer que mudou.'
  );
}
