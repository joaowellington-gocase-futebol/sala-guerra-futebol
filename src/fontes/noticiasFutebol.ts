// Fonte de dado real do Torcedor Fanático: RSS público do ge.globo, buscado
// server-side — o mesmo princípio de "toda coleta externa vive no Worker" que
// já rege o radar-futebol. Sem isso o agente reagiria só ao conhecimento
// congelado do modelo, e o pedido do João foi explícito: dados reais.
//
// Feeds confirmados ao vivo (curl, 2026-09-11): o geral cobre qualquer clube
// via filtro de palavra; o do Ceará entra dedicado porque é o time do coração
// do agente. NÃO adicionar feed por clube "no chute" pelo padrão de UF — testado
// aqui mesmo, `/rss/ge/rj/futebol/times/flamengo/` e `/rss/ge/sp/futebol/times/
// corinthians/` devolvem feed vazio (o segmento de UF do ge.globo não é
// simplesmente a sigla do estado do clube). Sem verificar de novo com curl,
// não confie em outro caminho por clube — o filtro de palavra no feed geral
// já cobre todos os licenciados.
import type { Env } from '../aiproxy';
import { REGEX_CLUBES_LICENCIADOS } from './clubesLicenciados';

const FEEDS = [
  { fonte: 'ge.globo/futebol', url: 'https://ge.globo.com/rss/ge/futebol/' },
  { fonte: 'ge.globo/ceara', url: 'https://ge.globo.com/rss/ge/ce/futebol/times/ceara/' },
];

const UA = 'SalaGuerraFutebol/1.0 (Gocase; contato: growth@gocase.com)';

export interface ManchetesResultado {
  ok: boolean;
  manchetes: { titulo: string; link: string; data: string; fonte: string }[];
  erro?: string;
}

function extrairTag(bloco: string, tag: string): string {
  const m = bloco.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return (m?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
}

function parsearFeed(xml: string, fonte: string) {
  return xml.split('<item>').slice(1).map((bloco) => ({
    titulo: extrairTag(bloco, 'title'),
    link: extrairTag(bloco, 'link'),
    data: extrairTag(bloco, 'pubDate'),
    fonte,
  })).filter((i) => i.titulo);
}

/** Busca as manchetes reais e filtra às que mencionam clube licenciado ou "futebol" no título. */
export async function buscarManchetesReais(env: Env): Promise<ManchetesResultado> {
  const regexClube = new RegExp(REGEX_CLUBES_LICENCIADOS, 'i');
  const todas: { titulo: string; link: string; data: string; fonte: string }[] = [];
  const falhas: string[] = [];

  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) { falhas.push(`${feed.fonte}: HTTP ${res.status}`); continue; }
      const xml = await res.text();
      todas.push(...parsearFeed(xml, feed.fonte));
    } catch (e) {
      falhas.push(`${feed.fonte}: ${(e as Error)?.message || String(e)}`);
    }
  }

  const relevantes = todas.filter((m) => regexClube.test(m.titulo));
  const vistos = new Set<string>();
  const dedupe = relevantes.filter((m) => (vistos.has(m.link) ? false : (vistos.add(m.link), true)));

  if (dedupe.length === 0 && falhas.length === FEEDS.length) {
    return { ok: false, manchetes: [], erro: falhas.join('; ') };
  }
  return { ok: true, manchetes: dedupe.slice(0, 20) };
}
