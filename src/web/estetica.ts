// A fonte de ESTÉTICA — o que a Nina precisa e que nenhum banco de vendas tem.
//
// Venda diz o que saiu; não diz por que aquela peça era bonita. Até aqui a
// referência visual vinha do app acervo-futebol (catálogo pré-coletado, sempre
// atrasado). Agora são feeds vivos, cada um com um papel:
//
//   Footy Headlines — vazamento e lançamento de uniforme do mundo inteiro. É a
//     fonte mais próxima do produto da Gocase que existe de graça: quando um
//     clube grande lança terceira camisa com grafismo novo, aquilo vira
//     referência de estampa no Brasil em semanas.
//   Hypebeast — colab, drop, streetwear. É onde a linguagem visual que chega
//     no torcedor jovem aparece primeiro.
//   Dezeen — design e arquitetura. Entra pela lateral: padrão, tipografia e
//     cor que ainda não viraram lugar-comum no esporte.
//
// Confirmados ao vivo em 16/09/2026 (o Footy Headlines só responde seguindo
// redirect — o feed original devolve 301).

import { buscarFeed, filtrarPorPalavras, type ItemDeFeed } from './http';

const FEEDS = [
  { fonte: 'Footy Headlines (uniformes)', url: 'https://www.footyheadlines.com/feeds/posts/default?alt=rss', limite: 14, filtro: null },
  { fonte: 'Hypebeast (streetwear/colab)', url: 'https://hypebeast.com/feed', limite: 25, filtro: /football|soccer|jersey|kit|club|adidas|nike|puma|umbro|collab|capsule|graphic/i },
  { fonte: 'Dezeen (design)', url: 'https://www.dezeen.com/feed/', limite: 25, filtro: /pattern|graphic|typograph|colou?r|identity|branding|textile|mural|tile/i },
];

export interface Estetica {
  ok: boolean;
  uniformes: ItemDeFeed[];
  cultura_visual: ItemDeFeed[];
  falhas: string[];
}

export async function buscarEstetica(): Promise<Estetica> {
  const rs = await Promise.all(FEEDS.map((f) => buscarFeed(f.url, f.fonte, f.limite)));
  const falhas: string[] = [];
  const uniformes: ItemDeFeed[] = [];
  const cultura: ItemDeFeed[] = [];

  rs.forEach((r, i) => {
    const cfg = FEEDS[i];
    if (!r.ok) { falhas.push(`${cfg.fonte}: ${r.erro}`); return; }
    const itens = cfg.filtro ? filtrarPorPalavras(r.itens, cfg.filtro) : r.itens;
    if (i === 0) uniformes.push(...itens);
    else cultura.push(...itens);
  });

  return { ok: uniformes.length + cultura.length > 0, uniformes, cultura_visual: cultura, falhas };
}

export function formatarEstetica(e: Estetica): string {
  if (!e.ok) return `ESTÉTICA: nenhuma fonte visual respondeu (${e.falhas.join('; ')}).`;
  const linha = (i: ItemDeFeed) => `- ${i.titulo}${i.resumo ? ` — ${i.resumo.slice(0, 150)}` : ''} · ${i.link}`;
  const partes: string[] = [];

  if (e.uniformes.length) {
    partes.push(
      'UNIFORMES E GRAFISMO DE FUTEBOL NO MUNDO (Footy Headlines, agora):\n' +
      e.uniformes.slice(0, 10).map(linha).join('\n'),
    );
  }
  if (e.cultura_visual.length) {
    partes.push(
      '\n\nLINGUAGEM VISUAL FORA DO FUTEBOL (streetwear e design — é daqui que sai o que ainda não virou clichê):\n' +
      e.cultura_visual.slice(0, 10).map(linha).join('\n'),
    );
  }
  if (e.falhas.length) partes.push(`\n\n(fontes com falha: ${e.falhas.join('; ')})`);
  return partes.join('');
}
