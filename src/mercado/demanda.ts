// O MAPA DE DEMANDA — o que o mercado masculino está pedindo, em número.
//
// POR QUE ISTO EXISTE (João, 22/09/2026): "não adianta me dar um
// direcionamento 'clube tal, estampa minimalista'. Eu quero tipo assim: o
// público masculino tem procurado por X Y Z de produtos, podemos adaptar para
// os produtos dessa forma. E aí depois disso, eu irei pensar como fazer virar
// uma demanda de futebol."
//
// A leitura que ele quer não é sobre clube — é sobre CATEGORIA e LINGUAGEM. E
// o dado pra isso já estava sendo coletado e jogado fora: a vitrine
// (src/web/vitrine.ts) lê mil produtos de quatro lojas, mas agregava por
// `loja · tipo`, o que produz "Stussy · Tops: 44 itens" — número verdadeiro e
// inútil, porque não diz nada sobre o mercado, só sobre uma loja.
//
// Aqui o corte é TRANSVERSAL: junta as quatro lojas, normaliza o tipo do
// Shopify numa família que a casa entende, e mede três coisas que só aparecem
// quando se olha o conjunto:
//
//   PESO      quanto a família representa do catálogo do mercado
//   EMPURRÃO  quanto dela é novidade de 45 dias — categoria que está sendo
//             empurrada agora, não estoque parado
//   PREÇO     a faixa praticada, que diz o patamar em que a categoria vive
//
// E o cruzamento que importa pro João: quais dessas famílias a CASA fabrica, e
// quais ela não fabrica. Uma família com empurrão alto e sem correspondente na
// casa é uma pergunta; com correspondente, é uma adaptação.
//
// LIMITE HONESTO, e ele está escrito no texto que vai pro prompt: isto é
// OFERTA, não procura. Mede o que o mercado decidiu apostar, não o que o
// consumidor pediu. A procura medida de verdade está em src/web/procura.ts
// (Wikipédia) e nos trends — e é por isso que o juiz não deixa a mesa dizer
// "confiança forte" apoiada só nisto aqui. Ver src/juiz.ts.

import type { Vitrine, ProdutoDaVitrine } from '../web/vitrine';
import type { Mundo } from '../web/mundo';

const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/**
 * As famílias em que o mercado é lido. A chave é o nome da família; `pistas`
 * são as palavras que a identificam no `product_type` ou no título do Shopify;
 * `naCasa` é o produto correspondente que a Gocase fabrica — vazio quando a
 * casa não faz nada parecido, e é justamente esse vazio que vira pergunta.
 */
const FAMILIAS: { familia: string; pistas: string[]; naCasa: string[] }[] = [
  { familia: 'camisa de clube', pistas: ['football shirt', 'jersey', 'kit', 'camiseta de futebol', 'shirt - football', 'retro shirt'], naCasa: [] },
  { familia: 'camiseta', pistas: ['t-shirt', 'tee', 'tshirt', 'camiseta', 'short sleeve'], naCasa: ['camiseta'] },
  { familia: 'moletom e casaco', pistas: ['hood', 'sweat', 'crew', 'jacket', 'fleece', 'moletom', 'coach jacket', 'track top'], naCasa: ['moletom'] },
  { familia: 'boné e chapéu', pistas: ['cap', 'hat', 'beanie', 'bucket', 'bone'], naCasa: ['boné'] },
  { familia: 'bolsa e mochila', pistas: ['bag', 'backpack', 'tote', 'pouch', 'mochila'], naCasa: ['mochila'] },
  { familia: 'calça e short', pistas: ['pant', 'short', 'trouser', 'jean', 'sweatpant'], naCasa: [] },
  { familia: 'calçado', pistas: ['shoe', 'sneaker', 'boot', 'footwear', 'sandal'], naCasa: [] },
  { familia: 'objeto e casa', pistas: ['mug', 'bottle', 'glass', 'towel', 'blanket', 'poster', 'print', 'ceramic', 'home', 'candle'], naCasa: ['caneca', 'térmico', 'garrafa', 'copo', 'toalha', 'almofada'] },
  { familia: 'acessório pequeno', pistas: ['keychain', 'keyring', 'sticker', 'patch', 'pin', 'sock', 'scarf', 'belt', 'wallet', 'card holder'], naCasa: ['adesivo', 'chaveiro'] },
  { familia: 'eletrônico e capa', pistas: ['phone case', 'case', 'airpod', 'tech', 'capinha'], naCasa: ['capinha'] },
];

export function familiaDe(p: { tipo: string; titulo: string }): string {
  const alvo = `${norm(p.tipo)} ${norm(p.titulo)}`;
  for (const f of FAMILIAS) {
    if (f.pistas.some((pista) => alvo.includes(norm(pista)))) return f.familia;
  }
  return 'outros';
}

export function produtosDaCasaPara(familia: string): string[] {
  return FAMILIAS.find((f) => f.familia === familia)?.naCasa ?? [];
}

export interface FamiliaDoMercado {
  familia: string;
  itens: number;
  /** Quanto a família pesa no catálogo do mercado, em %. */
  peso_pct: number;
  novos_45d: number;
  /** Quanto dos lançamentos de 45 dias do mercado inteiro é desta família, em %. */
  share_lancamentos_pct: number;
  /** Quanto da própria família é novidade, em % — o empurrão que ela está levando. */
  renovacao_pct: number;
  preco_medio: number;
  preco_min: number;
  preco_max: number;
  lojas: string[];
  /** O que a casa fabrica que corresponde a isto. Vazio = a casa não faz nada parecido. */
  na_casa: string[];
}

export interface PalavraDoMercado {
  palavra: string;
  /** Em quantos lançamentos de 45 dias ela aparece. */
  nos_lancamentos: number;
  /** Quantas vezes ela aparece HOJE fora da prateleira: imprensa, estética, cultura, torcida. */
  fora_da_prateleira: number;
  /**
   * 'so_oferta'  = o mercado está empurrando e ninguém está falando — aposta da indústria.
   * 'dois_lados' = aparece na prateleira E na conversa — é o sinal mais forte que temos.
   * 'so_conversa'= está na conversa e ainda não virou produto — território aberto.
   */
  onde: 'so_oferta' | 'dois_lados' | 'so_conversa';
}

export interface MapaDeDemanda {
  ok: boolean;
  total_produtos: number;
  total_novidades_45d: number;
  familias: FamiliaDoMercado[];
  palavras: PalavraDoMercado[];
  /** Famílias com empurrão acima da média e sem correspondente na casa. */
  buracos: string[];
  falhas: string[];
}

function media(ns: number[]): number {
  return ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0;
}

function pct(parte: number, todo: number): number {
  return todo > 0 ? Math.round((parte / todo) * 100) : 0;
}

/** Quantas vezes a palavra aparece hoje fora dos catálogos — imprensa, estética, cultura, torcida. */
function foraDaPrateleira(m: Mundo | undefined, palavra: string): number {
  if (!m) return 0;
  const p = norm(palavra);
  if (p.length < 3) return 0;
  const bate = (s: string) => norm(s).includes(p);
  return [
    ...m.noticias.concorrencia, ...m.noticias.uniformes, ...m.noticias.clubes,
  ].filter((i) => bate(i.titulo) || bate(i.resumo)).length
    + [...m.estetica.uniformes, ...m.estetica.cultura_visual].filter((i) => bate(i.titulo) || bate(i.resumo)).length
    + m.procura.temas.filter((t) => bate(t.titulo) || bate(t.oque)).length
    + m.torcida.assuntos.filter((a) => bate(a.titulo)).length;
}

/** Síncrono: o dado já veio da rede, aqui é só cruzamento. */
export function montarMapaDeDemanda(vitrine: Vitrine, mundo?: Mundo): MapaDeDemanda {
  if (!vitrine.ok || !vitrine.produtos.length) {
    return {
      ok: false, total_produtos: 0, total_novidades_45d: 0, familias: [], palavras: [], buracos: [],
      falhas: vitrine.falhas.length ? vitrine.falhas : ['a vitrine não trouxe produto nenhum'],
    };
  }

  const total = vitrine.produtos.length;
  const totalNovos = vitrine.novidades.length;

  const porFamilia = new Map<string, ProdutoDaVitrine[]>();
  for (const p of vitrine.produtos) {
    const f = familiaDe(p);
    porFamilia.set(f, [...(porFamilia.get(f) || []), p]);
  }

  const familias: FamiliaDoMercado[] = [...porFamilia.entries()]
    .filter(([familia, ps]) => familia !== 'outros' && ps.length >= 3)
    .map(([familia, ps]) => {
      const precos = ps.map((p) => p.preco).filter((x) => x > 0);
      const novos = ps.filter((p) => p.dias_no_ar <= 45);
      return {
        familia,
        itens: ps.length,
        peso_pct: pct(ps.length, total),
        novos_45d: novos.length,
        share_lancamentos_pct: pct(novos.length, totalNovos),
        renovacao_pct: pct(novos.length, ps.length),
        preco_medio: media(precos),
        preco_min: precos.length ? Math.min(...precos) : 0,
        preco_max: precos.length ? Math.max(...precos) : 0,
        lojas: [...new Set(ps.map((p) => p.loja))],
        na_casa: produtosDaCasaPara(familia),
      };
    })
    .sort((a, b) => b.share_lancamentos_pct - a.share_lancamentos_pct);

  // A palavra só interessa cruzada: na prateleira e fora dela. É esse cruzamento
  // que separa "a indústria está empurrando" de "as pessoas estão falando".
  const palavras: PalavraDoMercado[] = vitrine.temasDoMomento.map((t) => {
    const fora = foraDaPrateleira(mundo, t.palavra);
    return {
      palavra: t.palavra,
      nos_lancamentos: t.vezes,
      fora_da_prateleira: fora,
      onde: fora > 0 ? ('dois_lados' as const) : ('so_oferta' as const),
    };
  });

  // O que está na conversa e ainda NÃO virou produto: cultura em alta cuja
  // palavra não aparece em lançamento nenhum. É o único lugar onde a casa pode
  // chegar antes do mercado, então vale listar mesmo sendo poucos.
  if (mundo) {
    const naPrateleira = new Set(vitrine.temasDoMomento.map((t) => norm(t.palavra)));
    for (const tema of mundo.procura.temas.filter((t) => t.tipo === 'cultura').slice(0, 8)) {
      const primeira = norm(tema.titulo).split(/\s+/)[0];
      if (primeira.length < 4 || naPrateleira.has(primeira)) continue;
      palavras.push({
        palavra: tema.titulo, nos_lancamentos: 0, fora_da_prateleira: tema.views, onde: 'so_conversa',
      });
    }
  }

  const empurraoMedio = media(familias.map((f) => f.renovacao_pct));
  const buracos = familias
    .filter((f) => !f.na_casa.length && f.renovacao_pct >= empurraoMedio && f.novos_45d >= 5)
    .map((f) => f.familia);

  return {
    ok: familias.length > 0,
    total_produtos: total,
    total_novidades_45d: totalNovos,
    familias,
    palavras: palavras.slice(0, 22),
    buracos,
    falhas: vitrine.falhas,
  };
}

/**
 * Todos os números que a rodada pode honestamente citar. O juiz confere a
 * evidência da mesa contra isto: número que não está aqui não foi medido hoje.
 * Ver `conferirNumeros` em src/juiz.ts.
 */
export function numerosDaRodada(mapa: MapaDeDemanda, mundo?: Mundo): Set<number> {
  const s = new Set<number>();
  const por = (n: number | null | undefined) => {
    if (n === null || n === undefined || !isFinite(n)) return;
    s.add(Math.round(Math.abs(n)));
  };

  // As janelas são vocabulário da rodada: a mesa escreve "em 45 dias" e isso
  // não é número inventado, é o recorte que o próprio dado usa.
  for (const janela of [14, 28, 45]) s.add(janela);

  por(mapa.total_produtos);
  por(mapa.total_novidades_45d);
  for (const f of mapa.familias) {
    por(f.itens); por(f.peso_pct); por(f.novos_45d); por(f.share_lancamentos_pct);
    por(f.renovacao_pct); por(f.preco_medio); por(f.preco_min); por(f.preco_max);
  }
  for (const p of mapa.palavras) { por(p.nos_lancamentos); por(p.fora_da_prateleira); }

  if (mundo) {
    for (const c of mundo.procura.clubes) {
      por(c.views_14d); por(c.views_14d_ant); por(c.variacao_pct); por(c.pico?.views);
    }
    for (const t of mundo.procura.temas) por(t.views);
    for (const j of mundo.calendario.proximos) por(j.em_dias);
    por(mundo.calendario.proximos.length);
  }
  return s;
}

/**
 * Só os números de PROCURA medida — Wikipédia e trends. O juiz usa este
 * subconjunto para barrar "confiança forte" apoiada apenas em oferta de
 * catálogo: oferta é o que a indústria apostou, procura é o que o público fez.
 */
export function numerosDeProcura(mundo?: Mundo): Set<number> {
  const s = new Set<number>();
  if (!mundo) return s;
  const por = (n: number | null | undefined) => {
    if (n === null || n === undefined || !isFinite(n)) return;
    s.add(Math.round(Math.abs(n)));
  };
  for (const c of mundo.procura.clubes) {
    por(c.views_14d); por(c.views_14d_ant); por(c.variacao_pct); por(c.pico?.views);
  }
  for (const t of mundo.procura.temas) por(t.views);
  return s;
}

export function formatarMapaDeDemanda(mapa: MapaDeDemanda): string {
  if (!mapa.ok) {
    return 'O MAPA DE DEMANDA NÃO CARREGOU nesta rodada' +
      (mapa.falhas.length ? ` (${mapa.falhas.join('; ')})` : '') +
      '. Sem ele você não tem número de mercado — diga isso em vez de estimar.';
  }

  const partes: string[] = [
    '━━ O QUE O MERCADO MASCULINO ESTÁ PEDINDO (lido agora nos catálogos públicos) ━━',
    `Base: ${mapa.total_produtos} produtos no ar em quatro lojas do nicho, dos quais ${mapa.total_novidades_45d} ` +
    'entraram na prateleira nos últimos 45 dias.',
    '',
    'POR FAMÍLIA — "empurrão" é quanto da família é novidade de 45d; "dos lançamentos" é quanto ela pesa no ' +
    'que o mercado lançou no período:',
  ];

  partes.push(mapa.familias.slice(0, 10).map((f) =>
    `- ${f.familia}: ${f.itens} itens (${f.peso_pct}% do catálogo) | ${f.novos_45d} novos em 45d ` +
    `= ${f.share_lancamentos_pct}% dos lançamentos | empurrão ${f.renovacao_pct}% | ` +
    `preço médio ${f.preco_medio} (${f.preco_min}–${f.preco_max}) | ` +
    (f.na_casa.length ? `A CASA FAZ: ${f.na_casa.join(', ')}` : 'A CASA NÃO FAZ NADA PARECIDO'),
  ).join('\n'));

  const doisLados = mapa.palavras.filter((p) => p.onde === 'dois_lados');
  const soOferta = mapa.palavras.filter((p) => p.onde === 'so_oferta');
  const soConversa = mapa.palavras.filter((p) => p.onde === 'so_conversa');

  if (doisLados.length) {
    partes.push(
      '\nNA PRATELEIRA **E** NA CONVERSA (o sinal mais forte que esta rodada tem — o mercado lançou e o assunto ' +
      'circula fora da loja):\n' +
      doisLados.slice(0, 8).map((p) => `- "${p.palavra}": ${p.nos_lancamentos} lançamentos, ${p.fora_da_prateleira} menções hoje fora da prateleira`).join('\n'),
    );
  }
  if (soOferta.length) {
    partes.push(
      '\nSÓ NA PRATELEIRA (a indústria está empurrando, mas ninguém está falando — pode ser aposta cedo ou ' +
      'pode ser saturação):\n' +
      soOferta.slice(0, 8).map((p) => `- "${p.palavra}": ${p.nos_lancamentos} lançamentos, 0 menções fora`).join(', '),
    );
  }
  if (soConversa.length) {
    partes.push(
      '\nSÓ NA CONVERSA, AINDA SEM PRODUTO (o único lugar onde a casa chega antes do mercado):\n' +
      soConversa.slice(0, 6).map((p) => `- ${p.palavra}: ${p.fora_da_prateleira} leituras, nenhum lançamento`).join('\n'),
    );
  }

  if (mapa.buracos.length) {
    partes.push(
      `\nO MERCADO EMPURRA E A CASA NÃO FABRICA: ${mapa.buracos.join(', ')}. ` +
      'Não proponha que a casa passe a fabricar isso — proponha o que a linguagem dessa categoria vira num ' +
      'produto que ela JÁ fabrica.',
    );
  }

  partes.push(
    '\n⚠ O QUE ESTE BLOCO É E O QUE NÃO É: é OFERTA — o que o mercado decidiu apostar, com preço e data. ' +
    'NÃO é procura do consumidor. A procura medida desta rodada está no bloco de leituras da Wikipédia. ' +
    'Uma leitura apoiada só em oferta não pode se dizer "forte".',
  );

  if (mapa.falhas.length) partes.push(`\n(catálogos com falha: ${mapa.falhas.join('; ')})`);
  return partes.join('\n');
}
