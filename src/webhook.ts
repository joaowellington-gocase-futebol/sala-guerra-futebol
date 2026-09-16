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
  recomendacoes: { o_que: string; por_que: string; quem: string; ate_quando: string; risco: string }[];
  entregas: { nome: string; entrega: string; pronta: boolean }[];
  /** Quantas recomendações o juiz barrou por genéricas. Aparece no card como aviso de calibragem. */
  reprovadas: number;
  precisamos_de_voce: string;
  url: string;        // a salinha, reencenando esta reunião
  urlAta: string;     // a ata completa desta reunião
}

function limitar(s: string, n: number): string {
  const t = String(s ?? '').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Card do Google Chat. Texto em Markdown do Chat (*negrito*), sem HTML. */
function corpoGoogleChat(ata: AtaParaWebhook): unknown {
  const linhas: string[] = [];

  linhas.push(`*⚽ ${limitar(ata.tema, 110)}*`);
  linhas.push(`_${ata.automatica ? 'reunião automática' : 'reunião convocada'} · ${horaDeFortaleza(ata.quando)}_`);
  linhas.push('');
  linhas.push(limitar(ata.resumo_curto || ata.resumo, 340));

  // O que fazer vem primeiro. Se a mesa não recomendou nada, o card diz isso
  // com todas as letras em vez de disfarçar com leitura de mercado.
  if (ata.recomendacoes?.length) {
    linhas.push('');
    linhas.push('*🎯 O que a mesa recomenda:*');
    for (const r of ata.recomendacoes.slice(0, 3)) {
      linhas.push(`• ${limitar(r.o_que, 190)}` +
        (r.quem || r.ate_quando ? ` _(${[r.quem, r.ate_quando].filter(Boolean).join(', até ')})_` : ''));
    }
  } else {
    linhas.push('');
    linhas.push(ata.reprovadas
      ? `_A mesa não entregou recomendação: ${ata.reprovadas} foram barradas na conferência por serem genéricas demais (sem clube, produto, número ou prazo)._`
      : '_A mesa não recomendou nada nesta rodada — o dado de hoje não sustentou nenhuma decisão nova._');
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
