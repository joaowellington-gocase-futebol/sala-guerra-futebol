// A VITRINE — o que o mercado está vendendo, a que preço, e o que acabou de
// entrar na prateleira.
//
// POR QUE ISTO SUBSTITUI A VENDA INTERNA (João, 18/09/2026: "não precisamos do
// número de vendas, nem sei como tá sendo calculado isso; podemos mudar a
// lógica pra trazer dados comerciais no geral, tipo procura e consumo
// masculino"): a venda própria vinha de uma consulta ao datamart que ele não
// audita e que vivia estourando timeout. Ela dizia o que a Gocase vendeu; não
// dizia nada sobre o mercado em que ela vende.
//
// Uma loja Shopify publica o catálogo inteiro em /products.json, sem chave e
// sem login: título, tipo, preço, tags e a data em que o produto entrou no ar.
// Isso é dado comercial de verdade — a oferta do mercado, com preço praticado
// e novidade datada.
//
// As lojas foram escolhidas pelo que cada uma ensina, e todas foram conferidas
// ao vivo em 18/09/2026:
//   COPA Football       futebol retrô virando moda masculina — é o cruzamento
//                       exato do negócio da casa (250 produtos, 23 novos/45d)
//   Football Shirt Coll. camisa de clube como item de vestuário (115 novos/45d)
//   Stussy              streetwear de referência: o que vira gola, boné e
//                       gráfica no guarda-roupa masculino (243 novos/45d)
//   Kith                colaboração e drop — o topo da cadeia de hype (250/45d)

import { pegarJson } from './http';

export interface ProdutoDaVitrine {
  loja: string;
  titulo: string;
  tipo: string;
  preco: number;
  moeda: 'GBP/USD';
  publicado: string;
  dias_no_ar: number;
  tags: string[];
  link: string;
}

interface ProdutoShopify {
  title?: string;
  handle?: string;
  product_type?: string;
  published_at?: string;
  created_at?: string;
  tags?: string[] | string;
  variants?: { price?: string }[];
}

const LOJAS = [
  { nome: 'COPA Football', url: 'https://www.copafootball.com', oque: 'futebol retrô como moda masculina' },
  { nome: 'Football Shirt Collective', url: 'https://www.footballshirtcollective.com', oque: 'camisa de clube como vestuário' },
  { nome: 'Stussy', url: 'https://www.stussy.com', oque: 'streetwear de referência' },
  { nome: 'Kith', url: 'https://kith.com', oque: 'colaboração e drop' },
];

function dias(iso: string): number {
  const t = new Date(iso).getTime();
  return isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 86400000)) : 9999;
}

async function lerLoja(loja: { nome: string; url: string }): Promise<ProdutoDaVitrine[]> {
  const r = await pegarJson<{ products?: ProdutoShopify[] }>(`${loja.url}/products.json?limit=250`, 15000);
  if (!r.ok || !Array.isArray(r.dados?.products)) return [];
  return r.dados!.products!.map((p) => {
    const publicado = String(p.published_at || p.created_at || '');
    const tags = Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
    return {
      loja: loja.nome,
      titulo: String(p.title || '').trim(),
      tipo: String(p.product_type || 'sem tipo').trim(),
      preco: Number(p.variants?.[0]?.price || 0),
      moeda: 'GBP/USD' as const,
      publicado: publicado.slice(0, 10),
      dias_no_ar: publicado ? dias(publicado) : 9999,
      tags: tags.slice(0, 8),
      link: p.handle ? `${loja.url}/products/${p.handle}` : loja.url,
    };
  }).filter((p) => p.titulo);
}

export interface CategoriaDaVitrine {
  tipo: string; quantidade: number; novos_45d: number; preco_medio: number; preco_min: number; preco_max: number;
}

export interface Vitrine {
  ok: boolean;
  produtos: ProdutoDaVitrine[];
  novidades: ProdutoDaVitrine[];
  categorias: CategoriaDaVitrine[];
  /** Palavras que mais aparecem nos lançamentos — a linguagem do mercado agora. */
  temasDoMomento: { palavra: string; vezes: number }[];
  falhas: string[];
}

// Palavras que não ensinam nada sobre estética ou categoria.
const RUIDO = new Set([
  'the', 'and', 'with', 'for', 'new', 'de', 'da', 'do', 'em', 'a', 'o', 'e', 'shirt', 'tee',
  'size', 'color', 'colour', 'black', 'white', 'men', 'mens', 'women', 'unisex', 's', 'm', 'l', 'xl',
]);

export async function buscarVitrine(): Promise<Vitrine> {
  const listas = await Promise.all(LOJAS.map(lerLoja));
  const produtos = listas.flat();
  const falhas = LOJAS.filter((_, i) => listas[i].length === 0).map((l) => `${l.nome}: sem catálogo`);

  if (!produtos.length) return { ok: false, produtos: [], novidades: [], categorias: [], temasDoMomento: [], falhas };

  const novidades = produtos.filter((p) => p.dias_no_ar <= 45).sort((a, b) => a.dias_no_ar - b.dias_no_ar);

  const porTipo = new Map<string, ProdutoDaVitrine[]>();
  for (const p of produtos) {
    const chave = `${p.loja} · ${p.tipo}`;
    porTipo.set(chave, [...(porTipo.get(chave) || []), p]);
  }
  const categorias: CategoriaDaVitrine[] = [...porTipo.entries()]
    .map(([tipo, ps]) => {
      const precos = ps.map((p) => p.preco).filter((x) => x > 0);
      return {
        tipo, quantidade: ps.length,
        novos_45d: ps.filter((p) => p.dias_no_ar <= 45).length,
        preco_medio: precos.length ? Math.round(precos.reduce((a, b) => a + b, 0) / precos.length) : 0,
        preco_min: precos.length ? Math.min(...precos) : 0,
        preco_max: precos.length ? Math.max(...precos) : 0,
      };
    })
    .filter((c) => c.quantidade >= 3)
    .sort((a, b) => b.novos_45d - a.novos_45d)
    .slice(0, 16);

  // A linguagem do mercado: o que se repete nos títulos e tags do que é novo.
  const contagem = new Map<string, number>();
  for (const p of novidades) {
    const palavras = `${p.titulo} ${p.tags.join(' ')}`.toLowerCase().match(/[a-zà-ú]{3,}/g) || [];
    for (const w of new Set(palavras)) {
      if (RUIDO.has(w)) continue;
      contagem.set(w, (contagem.get(w) || 0) + 1);
    }
  }
  const temasDoMomento = [...contagem.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([palavra, vezes]) => ({ palavra, vezes }));

  return { ok: true, produtos, novidades, categorias, temasDoMomento, falhas };
}

export function formatarVitrine(v: Vitrine): string {
  if (!v.ok) return `VITRINE DO MERCADO: nenhum catálogo respondeu (${v.falhas.join('; ')}).`;

  const partes: string[] = [
    'VITRINE DO MERCADO (catálogos públicos de quem vende pro mesmo público, lidos agora) — é oferta real, ' +
    'com preço praticado e data de entrada na prateleira:',
  ];

  if (v.categorias.length) {
    partes.push(
      '\nCATEGORIAS E PREÇO (preço em libra/dólar, do catálogo original):\n' +
      v.categorias.slice(0, 12).map((c) =>
        `- ${c.tipo}: ${c.quantidade} itens, ${c.novos_45d} novos em 45d | preço médio ${c.preco_medio} (de ${c.preco_min} a ${c.preco_max})`,
      ).join('\n'),
    );
  }

  if (v.novidades.length) {
    partes.push(
      `\n\nO QUE ENTROU NA PRATELEIRA (${v.novidades.length} itens em 45 dias — os mais recentes):\n` +
      v.novidades.slice(0, 14).map((p) =>
        `- [${p.loja}] ${p.titulo} | ${p.tipo} | ${p.preco} | há ${p.dias_no_ar}d · ${p.link}`,
      ).join('\n'),
    );
  }

  if (v.temasDoMomento.length) {
    partes.push(
      '\n\nA LINGUAGEM DO MERCADO AGORA (palavras que mais se repetem no que é novo — serve pra saber o que já ' +
      'está saturado e o que ninguém está falando):\n' +
      v.temasDoMomento.map((t) => `${t.palavra} (${t.vezes}x)`).join(', '),
    );
  }

  if (v.falhas.length) partes.push(`\n\n(catálogos com falha: ${v.falhas.join('; ')})`);
  return partes.join('');
}
