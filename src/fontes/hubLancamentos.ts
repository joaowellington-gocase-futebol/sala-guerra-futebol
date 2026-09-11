// Fonte de dado real do agente Avaliador de Lançamentos: GMV e ranking real
// de vendas via Spree/Metabase, já calculado pelo hub-futebol (10731970).
//
// Limitação conhecida: /api/summary e /api/launches puxam Spree via um proxy
// que exige o cookie de sessão do visitante (hub-futebol/src/index.ts:634,653
// — `request.headers.get("Cookie")`), e uma chamada servidor-a-servidor não
// tem esse cookie. Isso só importa em CACHE MISS: o resultado do dia fica em
// cache no próprio env.DB do hub-futebol (chave `todayKey`), então funciona
// sem cookie sempre que alguém já abriu o dashboard pelo navegador naquele
// dia. Na primeira chamada de um dia novo, sem ninguém ter aberto ainda,
// espera-se falha — por isso `fontes_com_falha` é reportado ao agente em vez
// de escondido, e o Avaliador já sabe dizer "faltou dado" em vez de inventar.

import type { Env } from '../aiproxy';
import { fetchServico } from './servico';

const BASE_URL = 'https://hub-futebol.devgogroup.com';

export async function buscarResumoLancamentos(env: Env) {
  const [summary, launches] = await Promise.all([
    fetchServico(env, BASE_URL, '/api/summary'),
    fetchServico(env, BASE_URL, '/api/launches'),
  ]);
  const fontesComFalha: string[] = [];
  if (!summary.ok) fontesComFalha.push(`summary: ${summary.erro}`);
  if (!launches.ok) fontesComFalha.push(`launches: ${launches.erro}`);
  return {
    summary: summary.ok ? summary.dados : null,
    launches: launches.ok ? launches.dados : null,
    fontes_com_falha: fontesComFalha,
  };
}
