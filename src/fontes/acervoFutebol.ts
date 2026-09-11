// Fonte de dado real do Diretor de Arte e do Analista de Concorrência: o
// acervo de referência visual já coletado pelo acervo-futebol (91e34e59) —
// ArtStation, Bluesky, Shopify de concorrentes, feeds editoriais, Openverse.

import type { Env } from '../aiproxy';
import { fetchServico } from './servico';

const BASE_URL = 'https://acervo-futebol.devgogroup.com';

export async function buscarReferenciasAcervo(env: Env, filtros: { tema?: string; categoria?: string } = {}) {
  const qs = new URLSearchParams();
  if (filtros.tema) qs.set('tema', filtros.tema);
  if (filtros.categoria) qs.set('categoria', filtros.categoria);
  const query = qs.toString() ? `?${qs.toString()}` : '';

  const r = await fetchServico(env, BASE_URL, `/api/itens${query}`);
  if (!r.ok) return { itens: [], fontes_com_falha: [r.erro || 'falha desconhecida'] };
  return { itens: r.dados, fontes_com_falha: [] };
}
