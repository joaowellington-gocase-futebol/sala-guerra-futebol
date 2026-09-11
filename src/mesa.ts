// A mesa: como os agentes "conversam entre si usando o AI Proxy".
// Extraído do padrão embutido em server.ts da Fábrica de Térmicos
// (app/src/server.ts:81-89,278-335) para uso comum pelos 9 agentes daqui.
//
// Um agente devolve `recados_para: [{para, assunto, pedido}]` no JSON da sua
// resposta. O recado fica gravado com a `sessao` (o tema/lançamento em
// discussão) e é entregue ao destinatário — dentro do próprio prompt dele —
// na próxima vez que ele rodar. O agente responde em `atendi`, dizendo o que
// fez com cada recado, inclusive discordar. Isso é conversa real entre
// chamadas de AI Proxy, não um enfeite de UI.

import type { Env } from './aiproxy';

export interface Recado { id: number; de: string; assunto: string; pedido: string }

/** Recados pendentes para `chave` nesta sessão — entregues e marcados como lidos. */
export async function entregarRecados(env: Env, sessao: string, chave: string): Promise<Recado[]> {
  const q = await env.DB.query(
    'SELECT id, de, assunto, pedido FROM recados WHERE sessao = ? AND para = ? AND lido = 0 ORDER BY id',
    [sessao, chave],
  );
  const recados = q.rows as unknown as Recado[];
  for (const r of recados) {
    await env.DB.exec('UPDATE recados SET lido = 1 WHERE id = ?', [r.id]);
  }
  return recados;
}

/** Grava os recados que um agente deixou para colegas, a partir do `recados_para` da resposta. */
export async function registrarRecados(
  env: Env,
  sessao: string,
  de: string,
  saida: { para?: string; assunto?: string; pedido?: string }[] | undefined,
) {
  if (!saida?.length) return;
  for (const rc of saida) {
    if (!rc?.para) continue;
    await env.DB.exec(
      'INSERT INTO recados (sessao, de, para, assunto, pedido, quando) VALUES (?, ?, ?, ?, ?, ?)',
      [sessao, de, rc.para, rc.assunto || '', rc.pedido || '', new Date().toISOString()],
    );
  }
}

/** Monta o texto de recados pendentes para injetar no prompt do agente que vai rodar. */
export function formatarRecadosParaPrompt(recados: Recado[]): string {
  if (!recados.length) return '';
  const linhas = recados.map((r) => `- de ${r.de}: "${r.assunto}" — ${r.pedido}`).join('\n');
  return `\n\nRECADOS DE COLEGAS PARA VOCÊ NESTA SESSÃO (leve em conta de verdade e registre em "atendi"):\n${linhas}`;
}

export async function quadroDaSessao(env: Env, sessao: string) {
  const q = await env.DB.query(
    'SELECT de, para, assunto, pedido, lido, quando FROM recados WHERE sessao = ? ORDER BY id DESC LIMIT 60',
    [sessao],
  );
  return q.rows;
}
