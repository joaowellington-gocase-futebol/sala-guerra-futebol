// Entrega do resultado da reunião. O destino padrão é um espaço do Google Chat
// (mesmo mecanismo que o dashboard de pedidos travados da Giovanna já usa), mas
// a URL é detectada: se não for chat.googleapis.com, manda o JSON cru — assim
// um n8n/Make/endpoint próprio funciona sem mudar código.
//
// A URL fica em `config.webhook_url` (editável na tela, sem deploy) e cai pro
// secret WEBHOOK_URL se a config estiver vazia.
//
// O CARD É CURTO DE PROPÓSITO: quem recebe está no celular, entre uma coisa e
// outra. Ele entrega a RECOMENDAÇÃO da mesa em poucas linhas; tudo o que é
// detalhe (a investigação, cada rodada, o JSON de cada agente) mora na página
// da ata, que vai linkada. Card comprido não é mais informação — é menos gente
// lendo.
//
// A ordem do card mudou em 15/09/2026 junto com a mesa: primeiro o que fazer,
// depois o porquê. Antes ele abria com o que a casa passou a acreditar, e o
// João lia três linhas de leitura de mercado sem nunca chegar a uma decisão.
//
// Em 28/09/2026 encolheu de novo, a pedido dele: "queria que a ata no email
// fosse um pouco mais resumida — um feedback geral, e um tema tipo 'achamos
// que futebol e fontes únicas combinam, por XYZ'". O card agora é só a síntese
// (src/mercado/sintese.ts); evidência, ponte de produto, teses, placar e o que
// caiu por terra moram na página da ata. Ata antiga, sem síntese, cai no
// formato anterior.

import type { Env } from './aiproxy';
import { lerConfig } from './db';

export interface AtaParaWebhook {
  sessao: string;
  tema: string;
  quando: string;
  automatica: boolean;
  resumo: string;
  resumo_curto: string;
  consenso: string[];
  divergencias: { entre: string; sobre: string; posicoes: string }[];
  acoes: { agente: string; acao: string; prazo?: string }[];
  placar_vendas: string;
  /** A entrega da mesa desde 22/09/2026: leitura de mercado com ponte de produto. */
  leituras: {
    o_que_o_mercado_pede: string; evidencia: string; como_cabe: string;
    confianca: string; o_que_confirma: string; tese: string;
  }[];
  /** O que cada tese andou nesta rodada — é o que mostra que a mesa progrediu. */
  movimento_das_teses: { afirmacao: string; movimento: string; o_que_mudou: string; rodadas: number }[];
  entregas: { nome: string; entrega: string; pronta: boolean }[];
  /** Quantas recomendações o juiz barrou por genéricas. Aparece no card como aviso de calibragem. */
  reprovadas: number;
  precisamos_de_voce: string;
  /** Feedback geral + "achamos que…". Quando vem preenchida, é só ela que entra no card. */
  sintese?: { feedback_geral: string; achamos: { ideia: string; porque: string }[]; pedido: string };
  url: string;        // a salinha, reencenando esta reunião
  urlAta: string;     // a ata completa desta reunião
}

function limitar(s: string, n: number): string {
  const t = String(s ?? '').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** O card curto: feedback geral, o que achamos, o que precisa dele, e o link. */
function corpoSintese(ata: AtaParaWebhook): unknown {
  const s = ata.sintese!;
  const linhas: string[] = [];

  linhas.push(`*⚽ ${limitar(ata.tema, 110)}*`);
  linhas.push(`_${ata.automatica ? 'reunião automática' : 'reunião convocada'} · ${horaDeFortaleza(ata.quando)}_`);

  if (s.feedback_geral) {
    linhas.push('');
    linhas.push(`*Feedback geral:* ${s.feedback_geral}`);
  }

  if (s.achamos.length) {
    linhas.push('');
    for (const a of s.achamos) {
      linhas.push(`💡 *${a.ideia.replace(/[.…]$/, '')}* — ${a.porque}`);
    }
  }

  if (s.pedido) {
    linhas.push('');
    linhas.push(`🙋 *Precisa de você:* ${s.pedido}`);
  }

  if (ata.entregas?.length) {
    const n = ata.entregas.length;
    linhas.push(`📮 _${n === 1 ? 'Respondemos 1 pedido seu' : `Respondemos ${n} pedidos seus`} — está na ata._`);
  }

  linhas.push('');
  linhas.push(`<${ata.urlAta}|📄 Ata completa, com números e fontes>  ·  <${ata.url}|🕹 Salinha>`);

  return { text: linhas.join('\n') };
}

/** Card do Google Chat. Texto em Markdown do Chat (*negrito*), sem HTML. */
export function corpoGoogleChat(ata: AtaParaWebhook): unknown {
  if (ata.sintese && (ata.sintese.feedback_geral || ata.sintese.achamos.length)) return corpoSintese(ata);
  const linhas: string[] = [];

  linhas.push(`*⚽ ${limitar(ata.tema, 110)}*`);
  linhas.push(`_${ata.automatica ? 'reunião automática' : 'reunião convocada'} · ${horaDeFortaleza(ata.quando)}_`);
  linhas.push('');
  linhas.push(limitar(ata.resumo_curto || ata.resumo, 340));

  // A leitura vem primeiro, e vem inteira: o que o mercado pede, com que
  // número, e como isso cabe nos produtos da casa. Foi isto que o João pediu
  // em 22/09 — a decisão de futebol é dele, depois.
  if (ata.leituras?.length) {
    for (const l of ata.leituras.slice(0, 2)) {
      linhas.push('');
      linhas.push(`*🧭 ${limitar(l.o_que_o_mercado_pede, 220)}*`);
      linhas.push(`_${limitar(l.evidencia, 260)}_ (confiança ${l.confianca})`);
      linhas.push(`*↳ como cabe nos nossos produtos:* ${limitar(l.como_cabe, 260)}`);
      if (l.o_que_confirma) linhas.push(`🔭 _amanhã confirma ou derruba:_ ${limitar(l.o_que_confirma, 160)}`);
    }
  } else {
    linhas.push('');
    linhas.push(ata.reprovadas
      ? `_A mesa não entregou leitura: ${ata.reprovadas} foram barradas na conferência (sem categoria, sem número medido hoje, ou sem a ponte de produto)._`
      : '_A mesa não leu nada novo nesta rodada — o dado de hoje não sustentou nenhuma leitura._');
  }

  // O movimento das teses é o que mostra que a mesa está progredindo em vez de
  // recomeçar todo dia. Só o que mexeu entra no card; "parada" fica pra ata.
  const mexeu = (ata.movimento_das_teses || []).filter((m) => m.movimento !== 'parada');
  if (mexeu.length) {
    linhas.push('');
    linhas.push('*🧵 As teses da mesa:*');
    for (const m of mexeu.slice(0, 3)) {
      const icone = m.movimento === 'caiu' ? '✕' : m.movimento === 'nasceu' ? '✦' : '↑';
      linhas.push(`${icone} ${limitar(m.afirmacao, 150)}` +
        (m.movimento === 'confirmou' ? ` _(${m.rodadas} rodadas de pé)_` : ''));
    }
  }

  if (ata.entregas?.length) {
    linhas.push('');
    linhas.push('*📮 Do que você pediu:*');
    for (const e of ata.entregas.slice(0, 2)) {
      linhas.push(`• ${e.pronta ? '✅' : '🚧'} ${e.nome}: ${limitar(e.entrega, 180)}`);
    }
  }

  if (ata.precisamos_de_voce) {
    linhas.push('');
    linhas.push(`*🙋 A mesa precisa de você:* ${limitar(ata.precisamos_de_voce, 200)}`);
  }

  if (ata.placar_vendas) {
    linhas.push('');
    linhas.push(`🔬 ${limitar(ata.placar_vendas, 180)}`);
  }

  // O que caiu por terra continua no card: é a parte que ninguém costuma
  // contar e a que mais ensina.
  if (ata.divergencias?.length) {
    const d = ata.divergencias[0];
    linhas.push('');
    linhas.push(`❌ *Caiu por terra:* ${limitar(d.sobre, 120)} — ${limitar(d.posicoes, 120)}` +
      (ata.divergencias.length > 1 ? ` _(+${ata.divergencias.length - 1})_` : ''));
  }

  linhas.push('');
  linhas.push(`<${ata.urlAta}|📄 A reunião completa>  ·  <${ata.url}|🕹 Ver na salinha>`);

  return { text: linhas.join('\n') };
}

function horaDeFortaleza(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

/**
 * Posta um texto num webhook de Chat QUALQUER — a URL vem por parâmetro, não
 * da config global. É o que permite o Torcedor falar num espaço (o do Rian) e
 * as atas irem para outro, sem um canal pisar no outro.
 */
export async function postarNoChat(url: string, texto: string): Promise<{ ok: boolean; detalhe: string }> {
  if (!/^https:\/\//i.test(url)) return { ok: false, detalhe: 'URL precisa ser https' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify(/chat\.googleapis\.com/i.test(url) ? { text: texto } : { texto }),
    });
    if (!res.ok) return { ok: false, detalhe: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true, detalhe: /chat\.googleapis\.com/i.test(url) ? 'entregue no Google Chat' : 'entregue' };
  } catch (e) {
    return { ok: false, detalhe: 'falha ao entregar: ' + ((e as Error)?.message || String(e)) };
  }
}

/** Aviso curto no canal padrão das atas (usado pelo boletim semanal). */
export async function mandarAvisoCurto(env: Env, linhas: string[]): Promise<{ ok: boolean; detalhe: string }> {
  const url = await resolverUrlWebhook(env);
  if (!url) return { ok: false, detalhe: 'sem webhook configurado' };
  return postarNoChat(url, linhas.join('\n'));
}

export async function resolverUrlWebhook(env: Env): Promise<string> {
  const daConfig = await lerConfig(env, 'webhook_url');
  return (daConfig || env.WEBHOOK_URL || '').trim();
}

export async function dispararWebhook(env: Env, ata: AtaParaWebhook): Promise<{ ok: boolean; detalhe: string }> {
  const url = await resolverUrlWebhook(env);
  if (!url) {
    return { ok: false, detalhe: 'sem webhook configurado — cole a URL no painel ⚙ da sala' };
  }
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, detalhe: 'a URL do webhook precisa ser https' };
  }

  const ehGoogleChat = /chat\.googleapis\.com/i.test(url);
  // No JSON cru vai tudo, inclusive o resumo longo: quem consome por n8n quer
  // o dado inteiro, não a versão de celular.
  const corpo = ehGoogleChat ? corpoGoogleChat(ata) : ata;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify(corpo),
    });
    const texto = (await res.text()).slice(0, 200);
    if (!res.ok) return { ok: false, detalhe: `HTTP ${res.status}: ${texto}` };
    return { ok: true, detalhe: ehGoogleChat ? 'entregue no Google Chat' : 'entregue (JSON cru)' };
  } catch (e) {
    return { ok: false, detalhe: 'falha ao entregar: ' + ((e as Error)?.message || String(e)) };
  }
}
