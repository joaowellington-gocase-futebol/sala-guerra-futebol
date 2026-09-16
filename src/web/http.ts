// A base de toda coleta na internet aberta.
//
// POR QUE ESTE MÓDULO EXISTE (João, 16/09/2026): "desvincule todos os agentes
// ligados aos deploys, quero que procurem dados na internet real". Até aqui
// metade das fontes da mesa era outro app do GoDeploy (radar-futebol,
// acervo-futebol, hub-futebol) — o que significava que a mesa só enxergava o
// que outro app meu já tinha decidido coletar, com a frescura que aquele app
// tivesse. Dado de segunda mão, sempre atrasado, e nenhuma descoberta possível
// além do que já estava catalogado.
//
// Agora cada agente vai à fonte. Regras da casa para toda coleta aqui:
//   • sem chave de API e sem login — o que exige credencial não entra;
//   • timeout curto e falha silenciosa: fonte que cai não derruba a reunião,
//     vira aviso de "fonte com falha" que o agente lê e reporta;
//   • tudo que sai daqui carrega LINK. É o que permite ao João conferir, e é o
//     que impede o agente de inventar: sem link, o fato não entra na ata.

const UA = 'SalaGuerraFutebol/1.0 (Gocase; contato: growth@gocase.com)';

export interface Buscado<T> {
  ok: boolean;
  itens: T[];
  erro?: string;
  fonte: string;
}

export function vazio<T>(fonte: string, erro: string): Buscado<T> {
  return { ok: false, itens: [], erro, fonte };
}

/** GET com UA, timeout e sem exceção pra cima. */
export async function pegar(url: string, ms = 15000, aceita = '*/*'): Promise<{ ok: boolean; texto: string; erro?: string }> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: aceita },
      redirect: 'follow',
      signal: AbortSignal.timeout(ms),
    });
    if (!r.ok) return { ok: false, texto: '', erro: `HTTP ${r.status}` };
    return { ok: true, texto: await r.text() };
  } catch (e) {
    const m = (e as Error)?.message || String(e);
    return { ok: false, texto: '', erro: /timeout|aborted/i.test(m) ? `passou de ${ms / 1000}s` : m };
  }
}

export async function pegarJson<T = unknown>(url: string, ms = 15000): Promise<{ ok: boolean; dados?: T; erro?: string }> {
  const r = await pegar(url, ms, 'application/json');
  if (!r.ok) return { ok: false, erro: r.erro };
  try {
    return { ok: true, dados: JSON.parse(r.texto) as T };
  } catch {
    return { ok: false, erro: 'resposta não é JSON' };
  }
}

// ── Leitura de feed (RSS e Atom no mesmo parser) ─────────────────────────

export interface ItemDeFeed {
  titulo: string;
  link: string;
  data: string;
  fonte: string;
  resumo: string;
}

function tag(bloco: string, nome: string): string {
  const m = bloco.match(new RegExp(`<${nome}[^>]*>([\\s\\S]*?)<\\/${nome}>`, 'i'));
  return limpar(m?.[1] || '');
}

/** Atom usa <link href="..."/>, RSS usa <link>...</link>. Os dois no mesmo lugar. */
function link(bloco: string): string {
  const atom = bloco.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
    || bloco.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (atom?.[1]) return atom[1];
  return tag(bloco, 'link');
}

export function limpar(s: string): string {
  return String(s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lê RSS ou Atom e devolve os itens. Um feed quebrado devolve lista vazia, não exceção. */
export function lerFeed(xml: string, fonte: string, limite = 12): ItemDeFeed[] {
  const blocos = xml.includes('<item') ? xml.split(/<item[\s>]/i).slice(1) : xml.split(/<entry[\s>]/i).slice(1);
  return blocos.slice(0, limite * 2).map((b) => ({
    titulo: tag(b, 'title'),
    link: link(b),
    data: tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated'),
    fonte,
    resumo: (tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 320),
  })).filter((i) => i.titulo && i.link).slice(0, limite);
}

export async function buscarFeed(url: string, fonte: string, limite = 12): Promise<Buscado<ItemDeFeed>> {
  const r = await pegar(url, 15000, 'application/rss+xml, application/atom+xml, application/xml');
  if (!r.ok) return vazio<ItemDeFeed>(fonte, r.erro || 'falhou');
  const itens = lerFeed(r.texto, fonte, limite);
  if (!itens.length) return vazio<ItemDeFeed>(fonte, 'feed veio sem itens legíveis');
  return { ok: true, itens, fonte };
}

/** Mantém só o que fala de futebol brasileiro — usado nos feeds de fora do nicho. */
export function filtrarPorPalavras(itens: ItemDeFeed[], palavras: RegExp): ItemDeFeed[] {
  return itens.filter((i) => palavras.test(`${i.titulo} ${i.resumo}`));
}
