// Fetch server-to-server para os outros apps GoDeploy do João (radar-futebol,
// hub-futebol, acervo-futebol). Os três são `visibility: authenticated` —
// pensado pra sessão de navegador, um Worker não tem essa sessão. NÃO precisa
// editar esses apps: o GoDeploy já tem um mecanismo oficial pra isso — uma API
// key (`gdk_...`) criada no console admin, escopo "user" (vale pra qualquer
// app que o dono dela consegue ver). Manda como `x-api-key`; o gateway
// autentica como o dono da chave, sem passar pelo código do app de origem.
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
  if (!env.GODEPLOY_API_KEY) {
    return { ok: false, erro: 'Falta o GODEPLOY_API_KEY deste app (setAppSecret) — gere uma API key "user" no console admin do GoDeploy.' };
  }
  try {
    const res = await fetch(baseUrl + caminho, {
      headers: { 'x-api-key': env.GODEPLOY_API_KEY },
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
