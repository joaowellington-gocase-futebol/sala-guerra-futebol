// Fonte de dado real do agente Tendências: o motor já em produção no
// radar-futebol (70d8f073) — curvas de procura, calendário do Brasileirão,
// lançamentos de uniforme na Europa, concorrência licenciada, mercado.
// Não recalcula nada disso aqui, só consulta.

import type { Env } from '../aiproxy';
import { fetchServico } from './servico';

const BASE_URL = 'https://radar-futebol.devgogroup.com';

export async function buscarPainelTendencias(env: Env) {
  const [panorama, calendario, uniformeEuropa, concorrencia, mercado] = await Promise.all([
    fetchServico(env, BASE_URL, '/api/futebol/panorama'),
    fetchServico(env, BASE_URL, '/api/futebol/calendario'),
    fetchServico(env, BASE_URL, '/api/futebol/estampas'),
    fetchServico(env, BASE_URL, '/api/futebol/concorrencia'),
    fetchServico(env, BASE_URL, '/api/futebol/mercado'),
  ]);

  const fontesComFalha: string[] = [];
  const resultado: Record<string, unknown> = {};
  const nomear: [string, FetchServicoLike][] = [
    ['panorama', panorama], ['calendario', calendario], ['lancamentos_uniforme_europa', uniformeEuropa],
    ['concorrencia_licenciada', concorrencia], ['mercado', mercado],
  ];
  for (const [nome, r] of nomear) {
    if (r.ok) resultado[nome] = r.dados;
    else fontesComFalha.push(`${nome}: ${r.erro}`);
  }
  return { painel: resultado, fontes_com_falha: fontesComFalha };
}

type FetchServicoLike = { ok: boolean; dados?: unknown; erro?: string };
