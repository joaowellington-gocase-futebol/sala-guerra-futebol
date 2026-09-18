// A curva real de procura, da API pública de pageviews da Wikimedia.
//
// Por que isto vale mais que o Google Trends sozinho: o Trends dá o assunto do
// DIA (e some no dia seguinte), enquanto o pageview dá a SÉRIE — dá pra ver se
// o interesse por um clube está subindo há duas semanas ou se foi só o pico de
// uma notícia. Para quem produz estampa com prazo de dias, a diferença entre
// "subiu hoje" e "vem subindo" é a diferença entre chegar na hora e chegar
// atrasado.
//
// Duas coisas saem daqui:
//   1. CLUBES — quanta gente procurou cada clube nos últimos 14 dias contra os
//      14 anteriores. É procura de verdade, não palpite.
//   2. O QUE O BRASIL ESTÁ LENDO — o top de artigos em português do dia. É a
//      fonte mais criativa que existe de graça: filme, série, personagem,
//      novela, cantor, meme. Nada disso é futebol, e é exatamente por isso que
//      serve — é onde a casa acha tema de coleção que ninguém está fazendo.
//
// Sem chave, sem conta, sem limite observado. Confirmado ao vivo em 16/09/2026.

import { pegarJson } from './http';

const BASE = 'https://wikimedia.org/api/rest_v1/metrics/pageviews';

/** Clube → artigo na Wikipédia em português. Nome de artigo errado = série vazia. */
export const ARTIGO_DO_CLUBE: Record<string, string> = {
  'Flamengo': 'Clube_de_Regatas_do_Flamengo',
  'Corinthians': 'Sport_Club_Corinthians_Paulista',
  'Palmeiras': 'Sociedade_Esportiva_Palmeiras',
  'Vasco': 'Club_de_Regatas_Vasco_da_Gama',
  'Botafogo': 'Botafogo_de_Futebol_e_Regatas',
  'Fluminense': 'Fluminense_Football_Club',
  'São Paulo': 'São_Paulo_Futebol_Clube',
  'Internacional': 'Sport_Club_Internacional',
  'Grêmio': 'Grêmio_Foot-Ball_Porto_Alegrense',
  'Vitória': 'Esporte_Clube_Vitória',
  'Santos': 'Santos_Futebol_Clube',
  'Fortaleza': 'Fortaleza_Esporte_Clube',
  'Coritiba': 'Coritiba_Foot_Ball_Club',
  'Cruzeiro': 'Cruzeiro_Esporte_Clube',
  'Ceará': 'Ceará_Sporting_Club',
  'Bahia': 'Esporte_Clube_Bahia',
  'Atlético-MG': 'Clube_Atlético_Mineiro',
  'Sport': 'Sport_Club_do_Recife',
};

function aaaammdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

interface RespostaSerie { items?: { timestamp: string; views: number }[] }

export interface ProcuraDeClube {
  clube: string;
  views_14d: number;
  views_14d_ant: number;
  variacao_pct: number | null;
  pico: { dia: string; views: number } | null;
  link: string;
}

/** A série de um clube: 28 dias, partida em duas metades. */
async function serieDoClube(clube: string, artigo: string): Promise<ProcuraDeClube | null> {
  const fim = new Date(Date.now() - 86400000);          // ontem: hoje ainda não fechou
  const inicio = new Date(fim.getTime() - 27 * 86400000);
  const url = `${BASE}/per-article/pt.wikipedia/all-access/user/${encodeURIComponent(artigo)}/daily/${aaaammdd(inicio)}/${aaaammdd(fim)}`;
  const r = await pegarJson<RespostaSerie>(url, 12000);
  if (!r.ok || !r.dados?.items?.length) return null;

  const dias = r.dados.items.map((i) => ({ dia: `${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}-${i.timestamp.slice(6, 8)}`, views: Number(i.views || 0) }));
  const metade = Math.max(1, dias.length - 14);
  const recentes = dias.slice(metade);
  const antigos = dias.slice(0, metade);
  const soma = (xs: { views: number }[]) => xs.reduce((a, x) => a + x.views, 0);
  const v14 = soma(recentes), vAnt = soma(antigos);
  const pico = recentes.reduce((a, x) => (!a || x.views > a.views ? x : a), null as { dia: string; views: number } | null);

  return {
    clube, views_14d: v14, views_14d_ant: vAnt,
    variacao_pct: vAnt > 0 ? Math.round(((v14 - vAnt) / vAnt) * 100) : null,
    pico,
    link: `https://pt.wikipedia.org/wiki/${artigo}`,
  };
}

export interface TemaEmAlta {
  titulo: string;
  views: number;
  link: string;
  /** A descrição curta da Wikipédia. É ela que diz se aquilo é tema ou é notícia. */
  oque: string;
  tipo: 'cultura' | 'esporte' | 'noticia';
}

// A classificação é feita pela descrição do próprio artigo, não por palpite
// sobre o título. "Edson Fachin" e "One Piece" são indistinguíveis por título
// e óbvios pela descrição: "jurista e magistrado brasileiro" contra "mangá
// publicado na revista Weekly Shōnen Jump".
const E_CULTURA = /\b(filme|s[ée]rie|minis[ée]rie|man[gq][áa]|anime|jogo eletr[ôo]nico|videojogo|v[íi]deo ?game|[áa]lbum|banda|cantor|cantora|rapper|personagem|franquia|desenho animado|novela|telenovela|livro|romance|hist[óo]ria em quadrinhos|quadrinhos|super-?her[óo]i|dupla sertaneja|grupo musical|programa de televis[ãa]o|reality show|turn[êe]|filme de|saga)\b/i;
const E_ESPORTE = /\b(futebol|clube de futebol|jogador|jogadora|atleta|campeonato|copa|sele[çc][ãa]o|t[ée]cnico de futebol|treinador)\b/i;

/** Busca a descrição curta de vários artigos de uma vez (a API aceita lote). */
async function descrever(titulos: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (let i = 0; i < titulos.length; i += 40) {
    const lote = titulos.slice(i, i + 40);
    const url = 'https://pt.wikipedia.org/w/api.php?action=query&format=json&prop=description&titles=' +
      lote.map((t) => encodeURIComponent(t)).join('%7C');
    const r = await pegarJson<{ query?: { pages?: Record<string, { title?: string; description?: string }> } }>(url, 12000);
    if (!r.ok) continue;
    for (const pagina of Object.values(r.dados?.query?.pages || {})) {
      if (pagina?.title) mapa.set(pagina.title.replace(/ /g, '_'), String(pagina.description || ''));
    }
  }
  return mapa;
}

/**
 * O que o Brasil andou lendo nos últimos dias.
 *
 * Varre VÁRIOS dias e soma, em vez de olhar só ontem: testado em 16/09/2026, o
 * top de um dia só veio com 28 de 30 entradas sobre uma sessão do STF, e a
 * mesa ficaria sem material criativo por causa do noticiário daquela terça.
 * Filme, série e jogo aparecem de forma mais estável ao longo da semana — é a
 * diferença entre "o que explodiu ontem" e "o que o país está consumindo".
 */
export async function temasEmAlta(quantos = 25, dias = 4): Promise<{ ok: boolean; temas: TemaEmAlta[]; erro?: string }> {
  const lixo = /^(Wikipédia|Especial|Ficheiro|Categoria|Portal|Ajuda|Página_principal|Predefinição)/i;
  const soma = new Map<string, number>();
  const falhas: string[] = [];

  const buscas = await Promise.all(
    Array.from({ length: dias }, (_, i) => {
      const d = new Date(Date.now() - (i + 1) * 86400000);
      const url = `${BASE}/top/pt.wikipedia/all-access/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
      return pegarJson<{ items?: { articles?: { article: string; views: number }[] }[] }>(url, 12000);
    }),
  );

  for (const r of buscas) {
    if (!r.ok) { falhas.push(r.erro || 'falhou'); continue; }
    for (const a of r.dados?.items?.[0]?.articles || []) {
      if (lixo.test(a.article)) continue;
      soma.set(a.article, (soma.get(a.article) || 0) + Number(a.views || 0));
    }
  }

  if (!soma.size) return { ok: false, temas: [], erro: falhas.join('; ') || 'sem dados' };

  // Pega mais candidatos do que o pedido: a maioria vai ser descartada como
  // notícia, e é melhor sobrar material do que a mesa ficar sem tema.
  const brutos = [...soma.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(quantos, 60))
    .map(([article, views]) => ({ article, views }));

  const descricoes = await descrever(brutos.map((a) => a.article));

  const temas: TemaEmAlta[] = brutos.map((a) => {
    const oque = descricoes.get(a.article) || '';
    return {
      titulo: a.article.replace(/_/g, ' '),
      views: a.views,
      link: `https://pt.wikipedia.org/wiki/${a.article}`,
      oque,
      tipo: E_CULTURA.test(oque) ? 'cultura' : E_ESPORTE.test(oque) ? 'esporte' : 'noticia',
    };
  });

  return { ok: true, temas };
}

/** A série de UM clube, pelo nome. É o que o placar usa pra medir a aposta anterior. */
export async function procuraDeUmClube(nome: string): Promise<ProcuraDeClube | null> {
  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const chave = Object.keys(ARTIGO_DO_CLUBE).find((k) => norm(k) === norm(nome))
    || Object.keys(ARTIGO_DO_CLUBE).find((k) => norm(k).includes(norm(nome)) || norm(nome).includes(norm(k)));
  if (!chave) return null;
  return serieDoClube(chave, ARTIGO_DO_CLUBE[chave]);
}

export interface Procura {
  ok: boolean;
  clubes: ProcuraDeClube[];
  temas: TemaEmAlta[];
  falhas: string[];
}

/**
 * `prioridade` são os clubes que jogam na janela — eles entram sempre. O resto
 * da lista completa não é buscado: 18 séries por reunião é gasto sem retorno,
 * já que quem não joga raramente muda de patamar em duas semanas.
 */
export async function buscarProcura(prioridade: string[] = []): Promise<Procura> {
  const nomes = Object.keys(ARTIGO_DO_CLUBE);
  const casaCom = (n: string) => prioridade.some((p) => p.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(p.toLowerCase()));
  const escolhidos = prioridade.length ? nomes.filter(casaCom) : nomes;
  // Teto baixo de propósito: cada série é uma requisição externa e o Worker tem
  // limite de subrequests por execução. Os clubes que jogam na janela são os
  // que importam; quem não joga raramente muda de patamar em duas semanas.
  const lista = (escolhidos.length ? escolhidos : nomes).slice(0, 8);

  const [series, top] = await Promise.all([
    Promise.all(lista.map((c) => serieDoClube(c, ARTIGO_DO_CLUBE[c]))),
    temasEmAlta(),
  ]);

  const clubes = series.filter((x): x is ProcuraDeClube => x !== null)
    .sort((a, b) => (b.variacao_pct ?? -999) - (a.variacao_pct ?? -999));
  const falhas: string[] = [];
  const faltaram = lista.length - clubes.length;
  if (faltaram > 0) falhas.push(`${faltaram} clube(s) sem série de pageviews`);
  if (!top.ok) falhas.push(`temas em alta: ${top.erro}`);

  return { ok: clubes.length > 0 || top.temas.length > 0, clubes, temas: top.temas, falhas };
}

export function formatarProcura(p: Procura): string {
  if (!p.ok) return `PROCURA: não carregou (${p.falhas.join('; ')}).`;
  const partes: string[] = [];

  if (p.clubes.length) {
    partes.push(
      'PROCURA REAL POR CLUBE (Wikipédia pt, 14 dias contra os 14 anteriores — fonte aberta, consultada agora):\n' +
      p.clubes.map((c) =>
        `- ${c.clube}: ${c.views_14d} leituras em 14d` +
        (c.variacao_pct === null ? ' (sem base anterior)' : `, ${c.variacao_pct > 0 ? '+' : ''}${c.variacao_pct}% contra os 14 anteriores`) +
        (c.pico ? ` · pico em ${c.pico.dia} com ${c.pico.views}` : '') +
        ` · ${c.link}`,
      ).join('\n'),
    );
  }

  const cultura = p.temas.filter((t) => t.tipo === 'cultura');
  const esporte = p.temas.filter((t) => t.tipo === 'esporte');

  if (cultura.length) {
    partes.push(
      '\n\nCULTURA POP EM ALTA NO BRASIL AGORA (top da Wikipédia pt de ontem, já filtrado: só filme, série, ' +
      'mangá, jogo, música e personagem — política e notícia do dia foram descartadas). É aqui que aparece o ' +
      'tema de coleção que ninguém está fazendo ainda:\n' +
      cultura.slice(0, 12).map((t) => `- ${t.titulo} — ${t.oque || 'sem descrição'} (${t.views} leituras) · ${t.link}`).join('\n'),
    );
  } else {
    partes.push('\n\nCULTURA POP: nada de filme/série/jogo entrou no top de ontem — o dia foi de notícia.');
  }

  if (esporte.length) {
    partes.push(
      '\n\nESPORTE NO TOP DE LEITURA (quem do futebol o país foi procurar):\n' +
      esporte.slice(0, 8).map((t) => `- ${t.titulo} — ${t.oque} (${t.views} leituras) · ${t.link}`).join('\n'),
    );
  }

  if (p.falhas.length) partes.push(`\n\n(falhas: ${p.falhas.join('; ')})`);
  return partes.join('');
}
