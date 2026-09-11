// Fonte de dado real do agente Avaliador de Lançamentos: GMV e ranking real
// de vendas via Spree/Metabase, já calculado pelo hub-futebol (10731970).

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
