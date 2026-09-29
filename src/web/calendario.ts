// O calendário do Brasileirão, direto da API pública do globoesporte.
//
// Antes isto vinha do app radar-futebol por API key do GoDeploy: dado de
// segunda mão, varrido ~1x/dia por lá e só então lido aqui. Agora a mesa
// pergunta à fonte, na hora.
//
// A URL e o formato são os que o radar-futebol validou em 17/08/2026 varrendo
// a temporada inteira: 380 jogos, 38 rodadas, os 18 clássicos aparecendo 2x
// cada. Fica aqui o registro do que aquela investigação descobriu, porque é o
// tipo de coisa que se perde: a TheSportsDB com chave de teste TRUNCA toda
// rota em 5 itens, e por isso escondia metade da rodada — inclusive clássico.
//
// O id de campeonato e de fase são da temporada 2026. Quando virar 2027, são
// estas duas linhas que mudam.

import { pegarJson } from './http';

export const GE_CAMPEONATO = 'd1a37fa4-e948-43a6-ba53-ab24ab3a45b1';
export const GE_FASE = 'fase-unica-campeonato-brasileiro-2026';

/** Um campeonato no globoesporte: o id é o RESOURCE_ID da página de tabela do ge. */
export interface Campeonato { id: string; fase: string; inicio: string; nome: string }

export const SERIE_A: Campeonato = { id: GE_CAMPEONATO, fase: GE_FASE, inicio: '2026-03-29', nome: 'Série A' };
// A Série B entrou em 29/09/2026 com a agenda de jogos: Ceará, Sport e
// Fortaleza, licenciados da casa, jogam nela.
export const SERIE_B: Campeonato = {
  id: '009b5a68-dd09-46b8-95b3-293a2d494366', fase: 'brasileiro-serie-b-2026-fase-unica', inicio: '2026-03-20', nome: 'Série B',
};

export interface Jogo {
  rodada: number;
  data: string | null;
  hora: string | null;
  mandante: string;
  visitante: string;
  local: string | null;
  placar: string | null;
  /** dias a partir de hoje; negativo = já foi */
  em_dias: number | null;
  classico: boolean;
  campeonato?: string;
}

interface JogoBruto {
  id?: number | string;
  data_realizacao?: string | null;
  hora_realizacao?: string | null;
  placar_oficial_mandante?: number | null;
  placar_oficial_visitante?: number | null;
  equipes?: { mandante?: { nome_popular?: string }; visitante?: { nome_popular?: string } };
  sede?: { nome_popular?: string } | null;
}

// Clássicos que movem venda de produto de torcedor. Dupla sem ordem: a
// comparação é feita nos dois sentidos.
const CLASSICOS: [string, string][] = [
  ['Flamengo', 'Vasco'], ['Flamengo', 'Fluminense'], ['Flamengo', 'Botafogo'],
  ['Vasco', 'Botafogo'], ['Vasco', 'Fluminense'], ['Botafogo', 'Fluminense'],
  ['Corinthians', 'Palmeiras'], ['Corinthians', 'São Paulo'], ['Corinthians', 'Santos'],
  ['Palmeiras', 'São Paulo'], ['Palmeiras', 'Santos'], ['São Paulo', 'Santos'],
  ['Grêmio', 'Internacional'], ['Atlético-MG', 'Cruzeiro'], ['Bahia', 'Vitória'],
  ['Ceará', 'Fortaleza'], ['Sport', 'Náutico'], ['Sport', 'Santa Cruz'],
];

function ehClassico(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return CLASSICOS.some(([x, y]) =>
    (n(a).includes(n(x)) && n(b).includes(n(y))) || (n(a).includes(n(y)) && n(b).includes(n(x))));
}

function diasAte(data: string | null): number | null {
  if (!data) return null;
  const alvo = new Date(`${data}T12:00:00Z`).getTime();
  if (!isFinite(alvo)) return null;
  return Math.round((alvo - Date.now()) / 86400000);
}

async function buscarRodada(rodada: number, camp: Campeonato = SERIE_A): Promise<Jogo[]> {
  const url = `https://api.globoesporte.globo.com/tabela/${camp.id}/fase/${camp.fase}/rodada/${rodada}/jogos/`;
  const r = await pegarJson<JogoBruto[]>(url, 12000);
  if (!r.ok || !Array.isArray(r.dados)) return [];
  return r.dados.map((g) => {
    const mandante = g?.equipes?.mandante?.nome_popular?.trim() || '';
    const visitante = g?.equipes?.visitante?.nome_popular?.trim() || '';
    if (!mandante || !visitante) return null;
    const dt = g.data_realizacao ?? null;
    const data = dt ? String(dt).slice(0, 10) : null;
    const casa = g.placar_oficial_mandante, fora = g.placar_oficial_visitante;
    return {
      rodada, data,
      hora: g.hora_realizacao ? String(g.hora_realizacao).slice(0, 5) : dt ? String(dt).slice(11, 16) : null,
      mandante, visitante,
      local: g.sede?.nome_popular ?? null,
      placar: casa != null && fora != null ? `${casa}-${fora}` : null,
      em_dias: diasAte(data),
      classico: ehClassico(mandante, visitante),
      campeonato: camp.nome,
    } as Jogo;
  }).filter((j): j is Jogo => j !== null);
}

export interface Calendario {
  ok: boolean;
  /** O que vem pela frente na janela que dá pra produzir alguma coisa. */
  proximos: Jogo[];
  /** Clássicos à vista — é onde a camisa vende. */
  classicos: Jogo[];
  /** O que acabou de acontecer: resultado muda humor de torcida. */
  recentes: Jogo[];
  rodadaAtual: number | null;
  erro?: string;
}

/**
 * Descobre em que rodada estamos e devolve a janela útil.
 *
 * A primeira versão chutava a rodada por aritmética ("semanas desde o começo
 * da temporada") e errava por duas rodadas — o Brasileirão tem pausa de data
 * FIFA, jogo adiado e rodada de meio de semana, então semana decorrida não é
 * rodada. Em 16/09/2026 o palpite dava 25 e a rodada corrente era a 27: o
 * resultado era uma mesa que só via jogo que já tinha acontecido.
 *
 * Agora a busca se corrige: olha a última data que achou, calcula quantas
 * rodadas está atrasada (~7 dias por rodada) e salta pra lá. Até 3 tentativas,
 * o que cobre um erro inicial de umas 15 rodadas.
 */
export async function buscarCalendario(janelaDias = 14, camp: Campeonato = SERIE_A): Promise<Calendario> {
  const inicio = new Date(`${camp.inicio}T00:00:00Z`).getTime();
  const semanas = Math.floor((Date.now() - inicio) / (7 * 86400000));
  let palpite = Math.min(38, Math.max(1, semanas + 1));

  const vistos = new Map<number, Jogo[]>();
  const buscarTrio = async (base: number) => {
    const alvos = [base, base + 1, base + 2].filter((r) => r >= 1 && r <= 38 && !vistos.has(r));
    const listas = await Promise.all(alvos.map((r) => buscarRodada(r, camp)));
    alvos.forEach((r, i) => vistos.set(r, listas[i]));
  };

  for (let tentativa = 0; tentativa < 3; tentativa++) {
    await buscarTrio(palpite);
    const todos = [...vistos.values()].flat().filter((j) => j.em_dias !== null);
    if (!todos.length) break;
    const maisFuturo = Math.max(...todos.map((j) => j.em_dias as number));
    // Já enxergamos jogo por vir: a janela está coberta.
    if (maisFuturo >= 0) break;
    // Tudo no passado: salta o número de rodadas que falta, com uma de folga.
    const rodadasAtras = Math.max(1, Math.ceil(Math.abs(maisFuturo) / 7));
    const novo = Math.min(38, palpite + rodadasAtras + 1);
    if (novo === palpite) break;
    palpite = novo;
  }

  // A janela pode passar da última rodada buscada: com rodada no meio da
  // semana, o trio pode terminar hoje e a rodada seguinte ficar de fora (foi o
  // que aconteceu na Série B em 29/09/2026). Enquanto o jogo mais distante
  // ainda cair dentro da janela, busca mais um trio adiante.
  for (let extra = 0; extra < 2; extra++) {
    const todos = [...vistos.values()].flat().filter((j) => j.em_dias !== null);
    if (!todos.length) break;
    const maisFuturo = Math.max(...todos.map((j) => j.em_dias as number));
    const ultima = Math.max(...vistos.keys());
    if (maisFuturo > janelaDias || ultima >= 38) break;
    await buscarTrio(ultima + 1);
  }

  const jogos = [...vistos.values()].flat();
  if (!jogos.length) {
    return { ok: false, proximos: [], classicos: [], recentes: [], rodadaAtual: null, erro: 'a API do globoesporte não devolveu jogo nenhum' };
  }

  const comData = jogos.filter((j) => j.em_dias !== null);
  const proximos = comData.filter((j) => (j.em_dias as number) >= 0 && (j.em_dias as number) <= janelaDias)
    .sort((a, b) => (a.em_dias as number) - (b.em_dias as number));
  const recentes = comData.filter((j) => (j.em_dias as number) < 0 && (j.em_dias as number) >= -4 && j.placar)
    .sort((a, b) => (b.em_dias as number) - (a.em_dias as number));

  return {
    ok: true,
    proximos: proximos.slice(0, 20),
    classicos: proximos.filter((j) => j.classico),
    recentes: recentes.slice(0, 10),
    rodadaAtual: proximos[0]?.rodada ?? recentes[0]?.rodada ?? palpite,
  };
}

/** Os clubes que entram em campo na janela — quem deve estar na cabeça da mesa hoje. */
export function clubesEmJogo(c: Calendario): string[] {
  return [...new Set(c.proximos.flatMap((j) => [j.mandante, j.visitante]))];
}

export function formatarCalendario(c: Calendario): string {
  if (!c.ok) return `CALENDÁRIO: não carregou (${c.erro}).`;
  const linha = (j: Jogo) =>
    `- ${j.mandante} x ${j.visitante}` +
    (j.data ? ` em ${j.data}${j.hora ? ' ' + j.hora : ''}` : ' (data não publicada)') +
    (j.em_dias !== null ? ` — ${j.em_dias === 0 ? 'HOJE' : j.em_dias === 1 ? 'amanhã' : `daqui a ${j.em_dias} dias`}` : '') +
    (j.classico ? ' ⚔ CLÁSSICO' : '') +
    (j.placar ? ` [${j.placar}]` : '') +
    (j.local ? ` · ${j.local}` : '');

  return [
    `CALENDÁRIO REAL (globoesporte, rodada ${c.rodadaAtual}) — fonte aberta, consultada agora:`,
    c.proximos.length ? `\nPRÓXIMOS ${c.proximos.length} JOGOS:\n` + c.proximos.map(linha).join('\n') : '\nNenhum jogo na janela.',
    c.classicos.length ? `\n\n⚔ CLÁSSICOS À VISTA (é onde o torcedor abre a carteira):\n` + c.classicos.map(linha).join('\n') : '',
    c.recentes.length ? `\n\nO QUE ACABOU DE ACONTECER (resultado muda o humor de quem compra):\n` + c.recentes.map(linha).join('\n') : '',
  ].filter(Boolean).join('');
}
