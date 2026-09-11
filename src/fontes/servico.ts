// Fetch server-to-server para os outros apps GoDeploy do João (radar-futebol,
// hub-futebol, acervo-futebol). Os três são `visibility: authenticated`,
// pensados pra sessão de navegador — um Worker não tem essa sessão. A correção
// é aditiva: cada um passa a aceitar também o cabeçalho de serviço `X-Hub-Key`
// comparado a um secret compartilhado (HUB_SERVICE_KEY, mesmo valor nos 4
// apps), sem tirar a autenticação normal de quem usa pelo navegador.
//
// Nenhuma fonte aqui lança exceção pra cima: se falhar, devolve {ok:false,erro}
// e o agente segue com o que tiver, marcando confiança menor — mesmo princípio
// do radar-futebol/src/sources.ts ("fonte que falha não trava a análise").

import type { Env } from '../aiproxy';

export interface FetchServicoResultado {
  ok: boolean;
  dados?: unknown;
  erro?: string;
}

export async function fetchServico(env: Env, baseUrl: string, caminho: string): Promise<FetchServicoResultado> {
  if (!env.HUB_SERVICE_KEY) {
    return { ok: false, erro: 'Falta o HUB_SERVICE_KEY deste app (setAppSecret) — mesmo valor precisa estar configurado no app de origem.' };
  }
  try {
    const res = await fetch(baseUrl + caminho, {
      headers: { 'x-hub-key': env.HUB_SERVICE_KEY },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return { ok: false, erro: `${baseUrl}${caminho} respondeu HTTP ${res.status}` };
    }
    return { ok: true, dados: await res.json() };
  } catch (e) {
    return { ok: false, erro: `Falha ao buscar ${baseUrl}${caminho}: ${(e as Error)?.message || String(e)}` };
  }
}
