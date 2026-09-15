// Envio de e-mail a partir do Worker.
//
// Um Worker não abre socket SMTP — então mandar e-mail daqui é, obrigatoriamente,
// uma chamada HTTP pra um serviço de e-mail. Suporto dois caminhos, e o código
// escolhe sozinho pelo que estiver configurado:
//
//   1. RESEND_API_KEY  → api.resend.com (o mais direto: uma chave, e pronto).
//   2. config email_webhook → POST {para, assunto, texto, html} numa URL sua
//      (n8n, Make, Zapier, um endpoint interno). Pra quem já tem esteira.
//
// Sem nenhum dos dois, nada é enviado e a rota diz isso em vez de fingir que
// mandou — e-mail que "sumiu" é pior que e-mail que não saiu.
//
// Limite conhecido do Resend: conta sem domínio verificado só entrega para o
// endereço do próprio dono da conta. Pra alcançar outra pessoa é preciso
// verificar um domínio no DNS. O erro do Resend vem repassado inteiro no
// `detalhe` justamente pra isso aparecer na tela em vez de virar mistério.

import type { Env } from './aiproxy';
import { lerConfig } from './db';

export interface Carta { para: string; assunto: string; texto: string; html?: string }

export async function enviarEmail(env: Env, carta: Carta): Promise<{ ok: boolean; detalhe: string }> {
  const para = (carta.para || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) {
    return { ok: false, detalhe: 'endereço de destino inválido ou não configurado' };
  }

  if (env.RESEND_API_KEY) {
    const de = (await lerConfig(env, 'email_de')) || env.EMAIL_DE || 'Sala de Guerra <onboarding@resend.dev>';
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          from: de, to: [para], subject: carta.assunto,
          text: carta.texto, html: carta.html || undefined,
        }),
      });
      const corpo = (await res.text()).slice(0, 250);
      if (!res.ok) return { ok: false, detalhe: `Resend HTTP ${res.status}: ${corpo}` };
      return { ok: true, detalhe: `enviado para ${para} via Resend` };
    } catch (e) {
      return { ok: false, detalhe: 'falha no Resend: ' + ((e as Error)?.message || String(e)) };
    }
  }

  const webhook = await lerConfig(env, 'email_webhook');
  if (webhook && /^https:\/\//i.test(webhook)) {
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ para, assunto: carta.assunto, texto: carta.texto, html: carta.html || null }),
      });
      if (!res.ok) return { ok: false, detalhe: `webhook de e-mail HTTP ${res.status}` };
      return { ok: true, detalhe: `repassado para o seu webhook de e-mail (destino ${para})` };
    } catch (e) {
      return { ok: false, detalhe: 'falha no webhook de e-mail: ' + ((e as Error)?.message || String(e)) };
    }
  }

  return {
    ok: false,
    detalhe: 'sem caminho de envio: configure o secret RESEND_API_KEY, ou cole uma URL em "webhook de e-mail" no ⚙ Config',
  };
}
