// Google Trends do Brasil, por RSS.
//
// Por que isto entrou: o radar-futebol varre o calendário a cada ~20 h e tira
// snapshot 1x/dia. Era a fonte mais "viva" que o Tendências tinha, e mesmo
// assim quase nunca mudava entre duas reuniões — o que deixava o agente sem o
// que dizer e empurrava a mesa pro genérico.
//
// Este feed é público, sem chave, sem conta, e MUDA VÁRIAS VEZES POR DIA. Vem
// com o volume aproximado de busca e as manchetes que puxaram o termo. Serve
// pra duas coisas: dar assunto real ao Tendências, e fazer a impressão digital
// da reunião mudar quando o país muda de assunto — que é exatamente quando
// vale reunir.
//
// Confirmado ao vivo (curl, 14/09/2026): responde 200 com <item> contendo
// title, ht:approx_traffic e ht:news_item_title.

import type { Env } from '../aiproxy';
import { REGEX_CLUBES_LICENCIADOS } from './clubesLicenciados';

const URL_RSS = 'https://trends.google.com/trending/rss?geo=BR';
const UA = 'SalaGuerraFutebol/1.0 (Gocase; contato: growth@gocase.com)';

export interface TermoEmAlta {
  termo: string;
  volume: string;
  manchete: string;
  de_futebol: boolean;
}

export interface TendenciasGoogleResultado {
  ok: boolean;
  termos: TermoEmAlta[];
  erro?: string;
}

function tag(bloco: string, nome: string): string {
  const m = bloco.match(new RegExp(`<${nome}[^>]*>([\\s\\S]*?)<\\/${nome}>`));
  return (m?.[1] || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim();
}

export async function buscarTendenciasGoogle(_env: Env): Promise<TendenciasGoogleResultado> {
  try {
    const res = await fetch(URL_RSS, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false, termos: [], erro: `Google Trends HTTP ${res.status}` };

    const xml = await res.text();
    const regexClube = new RegExp(REGEX_CLUBES_LICENCIADOS, 'i');
    const termos = xml.split('<item>').slice(1).map((bloco) => {
      const termo = tag(bloco, 'title');
      const manchete = tag(bloco, 'ht:news_item_title');
      return {
        termo,
        volume: tag(bloco, 'ht:approx_traffic') || '?',
        manchete,
        // O casamento é no termo E na manchete: "Vozão" não bate a regex de
        // clube, mas a manchete que puxou o termo normalmente bate.
        de_futebol: regexClube.test(termo) || regexClube.test(manchete),
      };
    }).filter((t) => t.termo);

    if (!termos.length) return { ok: false, termos: [], erro: 'feed do Google Trends veio sem itens' };
    return { ok: true, termos: termos.slice(0, 20) };
  } catch (e) {
    return { ok: false, termos: [], erro: 'Falha no Google Trends: ' + ((e as Error)?.message || String(e)) };
  }
}
