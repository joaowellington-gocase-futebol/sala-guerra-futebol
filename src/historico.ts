// O que impede a mesa de repetir a si mesma.
//
// Diagnóstico que originou este arquivo (logs de 14/09/2026): o radar-futebol
// varre o calendário a cada ~20 h e tira snapshot 1x/dia; o hub-futebol serve o
// cache do dia. A reunião, porém, roda de 2 em 2 horas. Resultado: 11 das 12
// reuniões diárias recebiam ENTRADA IDÊNTICA — e um modelo com a mesma entrada
// devolve a mesma saída. A sensação de "estão falando a mesma coisa" não era
// falta de capricho no prompt, era a mesa sendo obrigada a decidir de novo o
// que já tinha decidido duas horas antes.
//
// Duas defesas nascem daqui:
//   1. IMPRESSÃO DIGITAL do dado bruto das fontes. Igual à da rodada anterior
//      = não há o que decidir; a reunião vira uma REVISÃO curta de pendências
//      em vez de um teatro de decisão nova.
//   2. NÃO REPITA: as últimas pautas, decisões e propostas entram no prompt
//      como lista de proibição explícita. Sem isso o modelo não tem como saber
//      que já disse aquilo — ele não lembra da reunião anterior.

import type { Env } from './aiproxy';

/** Chaves de tempo/cache que mudam a cada chamada sem mudar o FATO. */
const RUIDO = /(atualiz|timestamp|gerado|cache|consultad|_em$|^quando$|^agora$|^data_consulta$)/i;

/** Remove o que muda sozinho, pra sobrar só o fato. Ordena chaves pra o hash ser estável. */
function normalizar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizar);
  if (v && typeof v === 'object') {
    const saida: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (RUIDO.test(k)) continue;
      saida[k] = normalizar((v as Record<string, unknown>)[k]);
    }
    return saida;
  }
  return v;
}

/** djb2 — não precisa ser criptográfico, precisa ser estável e barato. */
export function impressaoDigital(dados: unknown): string {
  const texto = JSON.stringify(normalizar(dados));
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + '-' + texto.length.toString(36);
}

export interface AtaResumida {
  sessao: string; tema: string; quando: string; resumo_curto: string;
  acoes: { agente: string; acao: string }[];
  impressao: string;
}

function json(s: unknown, padrao: unknown = []): any {
  try { return JSON.parse(String(s ?? '')); } catch { return padrao; }
}

export async function ultimasAtas(env: Env, n = 6): Promise<AtaResumida[]> {
  const q = await env.DB.query(
    'SELECT sessao, tema, quando, resumo_curto, resumo, acoes, impressao FROM atas ORDER BY quando DESC LIMIT ?', [n]);
  return q.rows.map((r) => ({
    sessao: String(r.sessao), tema: String(r.tema || ''), quando: String(r.quando || ''),
    resumo_curto: String(r.resumo_curto || r.resumo || '').slice(0, 300),
    acoes: json(r.acoes), impressao: String(r.impressao || ''),
  }));
}

/**
 * O bloco de proibição. Vai no prompt de quem PROPÕE (pauta, escopo, régua) —
 * não no de quem só reporta fato.
 */
export function formatarNaoRepita(atas: AtaResumida[]): string {
  if (!atas.length) return '';
  const linhas = atas.map((a) => {
    const quando = a.quando.slice(5, 16).replace('T', ' ');
    const acoes = (a.acoes || []).slice(0, 3).map((x) => x?.acao).filter(Boolean).join('; ');
    return `- [${quando}] pauta: "${a.tema}" → ${a.resumo_curto}${acoes ? ` (ficou combinado: ${acoes})` : ''}`;
  }).join('\n');
  return (
    `\n\nO QUE ESTA MESA JÁ DECIDIU NAS ÚLTIMAS REUNIÕES — LEIA ANTES DE FALAR:\n${linhas}\n` +
    `REGRA DURA: não proponha de novo uma pauta, um escopo ou uma recomendação que já está nessa lista. ` +
    `Se o dado de hoje não sustenta nada NOVO em relação ao que está aí, a resposta certa é dizer isso ` +
    `explicitamente ("não tenho nada novo desde <a reunião de tal hora>, o que está de pé é X") em vez de ` +
    `reescrever a mesma ideia com outras palavras. Repetir a mesa é o pior resultado possível — pior que ` +
    `não ter achado nada.`
  );
}

/** As últimas falas do PRÓPRIO agente, pra ele não se repetir mesmo quando a pauta muda. */
export async function ultimasFalasDele(env: Env, chave: string, n = 4): Promise<string[]> {
  const q = await env.DB.query(
    'SELECT texto FROM falas WHERE chave = ? ORDER BY id DESC LIMIT ?', [chave, n]);
  return q.rows.map((r) => String(r.texto || '')).filter(Boolean);
}

export function formatarNaoSeRepita(falas: string[]): string {
  if (!falas.length) return '';
  return (
    `\n\nO QUE VOCÊ MESMO JÁ DISSE NAS ÚLTIMAS RODADAS (não repita, nem reformulado):\n` +
    falas.map((f) => `- "${f}"`).join('\n')
  );
}

// ── Dedupe de manchete entre reuniões ────────────────────────────────────
//
// O Torcedor reportava a mesma manchete a cada 2 h porque o RSS não muda nesse
// intervalo. Agora o que já foi reportado fica registrado e ele só fala do que
// é novo — se não há novo, ele diz que não há.

export async function manchetesNovas(
  env: Env,
  manchetes: { titulo: string; link: string; data: string; fonte: string }[],
): Promise<{ novas: typeof manchetes; jaVistas: number }> {
  if (!manchetes.length) return { novas: [], jaVistas: 0 };
  const q = await env.DB.query('SELECT chave FROM vistos WHERE tipo = ?', ['manchete']);
  const vistos = new Set(q.rows.map((r) => String(r.chave)));
  const novas = manchetes.filter((m) => !vistos.has(m.link));
  return { novas, jaVistas: manchetes.length - novas.length };
}

export async function marcarManchetesVistas(env: Env, manchetes: { link: string }[]) {
  const agora = new Date().toISOString();
  for (const m of manchetes.slice(0, 40)) {
    try {
      await env.DB.exec('INSERT OR IGNORE INTO vistos (tipo, chave, quando) VALUES (?, ?, ?)', ['manchete', m.link, agora]);
    } catch { /* dedupe é auxiliar; não trava a reunião */ }
  }
  // Não deixa a tabela crescer pra sempre: 30 dias é mais que suficiente pra
  // impedir a repetição, e mantém a memória do app pequena.
  try {
    await env.DB.exec('DELETE FROM vistos WHERE quando < ?', [new Date(Date.now() - 30 * 86400000).toISOString()]);
  } catch { /* idem */ }
}

/** As tarefas que a mesa combinou e ainda não foram declaradas resolvidas. */
export async function pendenciasAbertas(env: Env, n = 3): Promise<{ agente: string; acao: string; desde: string }[]> {
  const atas = await ultimasAtas(env, n);
  const saida: { agente: string; acao: string; desde: string }[] = [];
  for (const a of atas) {
    for (const x of (a.acoes || []).slice(0, 6)) {
      if (x?.agente && x?.acao) saida.push({ agente: String(x.agente), acao: String(x.acao), desde: a.quando.slice(5, 16).replace('T', ' ') });
    }
  }
  return saida.slice(0, 12);
}
