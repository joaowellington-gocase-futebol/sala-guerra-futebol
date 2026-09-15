// A memória da mesa — o que separa "9 agentes rodando em sequência" de um
// time que evolui. Depois de cada reunião o agente declara `aprendi`, e a
// mesa registra `cobranca` (a tarefa combinada pra ele). Na reunião seguinte
// os dois voltam pra dentro do system prompt dele.
//
// Regra de projeto: memória é CURTA e RECENTE. Injetar 200 lições no prompt
// degrada a resposta e estoura contexto; o agente lembra das últimas, como
// alguém que voltou de uma reunião há duas horas.

import type { Env } from './aiproxy';

export type TipoMemoria = 'aprendi' | 'cobranca' | 'vendas';

export interface LinhaMemoria { id: number; tipo: string; licao: string; origem_sessao: string; criado_em: string }

const LIMITE_PADRAO = 6;

export async function gravarMemoria(
  env: Env,
  chave: string,
  tipo: TipoMemoria,
  licoes: unknown,
  sessao: string,
) {
  const lista = (Array.isArray(licoes) ? licoes : [licoes])
    .map((l) => (typeof l === 'string' ? l : JSON.stringify(l)))
    .map((l) => l.trim())
    .filter((l) => l && l.length > 3)
    .slice(0, 5);
  const agora = new Date().toISOString();
  for (const licao of lista) {
    await env.DB.exec(
      'INSERT INTO memoria_agente (chave, tipo, licao, origem_sessao, criado_em) VALUES (?, ?, ?, ?, ?)',
      [chave, tipo, licao.slice(0, 400), sessao, agora],
    );
  }
}

export async function lembrar(env: Env, chave: string, limite = LIMITE_PADRAO): Promise<LinhaMemoria[]> {
  const q = await env.DB.query(
    'SELECT id, tipo, licao, origem_sessao, criado_em FROM memoria_agente WHERE chave = ? ORDER BY id DESC LIMIT ?',
    [chave, limite],
  );
  return (q.rows as unknown as LinhaMemoria[]).reverse(); // mais antigo primeiro, como uma conversa
}

/** O bloco de memória que entra no system prompt. Vazio quando o agente é novo na mesa. */
export function formatarMemoriaParaPrompt(memorias: LinhaMemoria[]): string {
  if (!memorias.length) return '';
  const rotulo: Record<string, string> = {
    aprendi: 'você aprendeu',
    cobranca: 'a mesa combinou que VOCÊ faria',
    vendas: 'o Mensurador mediu, sobre uma decisão sua',
  };
  const linhas = memorias
    .map((m) => `- (${rotulo[m.tipo] || m.tipo}) ${m.licao}`)
    .join('\n');
  return (
    `\n\nSUA MEMÓRIA DAS ÚLTIMAS REUNIÕES (é sua, ninguém mais vê assim):\n${linhas}\n` +
    `Use isto de verdade: não repita uma recomendação que já foi feita e não deu resultado, ` +
    `e se houver uma cobrança acima, comece dizendo o que aconteceu com ela ` +
    `(inclusive "não deu, porque..."). Evoluir é mudar de posição quando o dado mandou — ` +
    `não é ser coerente com você mesmo de duas horas atrás.`
  );
}

/** Memória de todo mundo, pra tela "o que a sala aprendeu". */
export async function memoriaDaSala(env: Env, limite = 80) {
  const q = await env.DB.query(
    'SELECT chave, tipo, licao, origem_sessao, criado_em FROM memoria_agente ORDER BY id DESC LIMIT ?',
    [limite],
  );
  return q.rows;
}
