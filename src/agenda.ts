// A AGENDA DE JOGOS — o alerta que vai junto com a ata.
//
// Pedido do João em 29/09/2026: "seria muito bom um alerta junto com a ata
// falando sobre os próximos jogos da semana — amanhã terá Ceará vs tal time —
// com margem de alguns dias, com foco em jogos do Flamengo ou jogos entre dois
// times licenciados da Gocase."
//
// É código puro, sem IA: calendário é fato, e fato não precisa de opinião. O
// que entra na lista, e por quê:
//   foco          todo jogo do clube em foco (config agenda_foco; padrão Flamengo)
//   licenciados   jogo entre DOIS clubes licenciados — as duas torcidas compram
//   clássico      clássico com pelo menos um licenciado
// Série A e Série B, porque Ceará, Sport e Fortaleza jogam na B.
//
// A margem é a config agenda_dias (padrão 10: com 7, uma pausa de data FIFA
// deixava a semana sem jogo nenhum).

import type { Env } from './aiproxy';
import { lerConfig } from './db';
import { buscarCalendario, SERIE_A, SERIE_B, type Jogo } from './web/calendario';
import type { Tabela } from './web/tabela';

/** Os 18 clubes licenciados, com o nome exatamente como o globoesporte escreve. */
export const CLUBES_LICENCIADOS = [
  'Flamengo', 'Corinthians', 'Palmeiras', 'Vasco', 'Botafogo', 'Fluminense', 'Atlético-MG', 'São Paulo',
  'Internacional', 'Grêmio', 'Vitória', 'Sport', 'Santos', 'Fortaleza', 'Coritiba', 'Cruzeiro', 'Ceará', 'Bahia',
];

const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Nome igual, não "contém": Botafogo-SP e Atlético-GO não são licenciados. */
export function ehLicenciado(clube: string): boolean {
  return CLUBES_LICENCIADOS.some((c) => norm(c) === norm(clube));
}

export interface JogoDaAgenda {
  data: string;
  hora: string | null;
  em_dias: number;
  mandante: string;
  visitante: string;
  campeonato: string;
  motivos: string[];
  /** Posição na tabela e o que está em jogo, quando a tabela carregou. */
  contexto: string;
}

export interface Agenda {
  ok: boolean;
  dias: number;
  foco: string[];
  jogos: JogoDaAgenda[];
  /** Os demais jogos de licenciado na janela — entram numa linha só, sem destaque. */
  outros?: JogoDaAgenda[];
  falhas: string[];
}

function posicao(t: Tabela | undefined, clube: string) {
  return t?.clubes.find((c) => norm(c.clube) === norm(clube));
}

function contextoDoJogo(j: Jogo, t: Tabela | undefined): { nomes: [string, string]; contexto: string } {
  const a = posicao(t, j.mandante), b = posicao(t, j.visitante);
  const nomes: [string, string] = [
    a ? `${j.mandante} (${a.posicao}º)` : j.mandante,
    b ? `${j.visitante} (${b.posicao}º)` : j.visitante,
  ];
  if (!a || !b || j.campeonato !== 'Série A') return { nomes, contexto: '' };
  const titulo = (s: string) => s === 'lider' || s === 'briga_titulo';
  const baixo = (s: string) => s === 'risco_rebaixamento' || s === 'zona_rebaixamento';
  let contexto = '';
  if (titulo(a.situacao) && titulo(b.situacao)) contexto = 'confronto direto pelo título';
  else if (baixo(a.situacao) && baixo(b.situacao)) contexto = 'confronto direto contra o rebaixamento';
  else if (titulo(a.situacao) || titulo(b.situacao)) contexto = `${titulo(a.situacao) ? j.mandante : j.visitante} na briga pelo título`;
  else if (baixo(a.situacao) || baixo(b.situacao)) contexto = `${baixo(a.situacao) ? j.mandante : j.visitante} brigando contra o rebaixamento`;
  return { nomes, contexto };
}

/** Escolhe os jogos que interessam. Pura, pra dar pra testar sem rede. */
export function escolherJogos(jogos: Jogo[], foco: string[], dias: number, tabelas: Record<string, Tabela> = {}): JogoDaAgenda[] {
  const emFoco = (c: string) => foco.some((f) => norm(f) === norm(c));
  const vistos = new Set<string>();
  const saida: JogoDaAgenda[] = [];
  for (const j of jogos) {
    if (!j.data || j.em_dias === null || j.em_dias < 0 || j.em_dias > dias) continue;
    const chave = `${j.data}|${j.mandante}|${j.visitante}`;
    if (vistos.has(chave)) continue;
    const motivos: string[] = [];
    const foc = [j.mandante, j.visitante].filter(emFoco);
    if (foc.length) motivos.push(`foco ${foc.join(' e ')}`);
    if (ehLicenciado(j.mandante) && ehLicenciado(j.visitante)) motivos.push('dois licenciados');
    if (j.classico && (ehLicenciado(j.mandante) || ehLicenciado(j.visitante))) motivos.push('clássico');
    if (!motivos.length) continue;
    vistos.add(chave);
    const { nomes, contexto } = contextoDoJogo(j, tabelas[j.campeonato || '']);
    saida.push({
      data: j.data, hora: j.hora, em_dias: j.em_dias,
      mandante: nomes[0], visitante: nomes[1], campeonato: j.campeonato || 'Série A',
      motivos, contexto,
    });
  }
  return saida.sort((a, b) => a.em_dias - b.em_dias || String(a.hora).localeCompare(String(b.hora)));
}

/** Jogo de UM licenciado que não entrou no destaque: vai na linha "também jogam". */
export function outrosJogos(jogos: Jogo[], destaque: JogoDaAgenda[], dias: number): JogoDaAgenda[] {
  const ja = new Set(destaque.map((d) => `${d.data}|${d.mandante.replace(/ \(\d+º\)$/, '')}`));
  const vistos = new Set<string>();
  return jogos
    .filter((j) => j.data && j.em_dias !== null && j.em_dias >= 0 && j.em_dias <= dias)
    .filter((j) => ehLicenciado(j.mandante) || ehLicenciado(j.visitante))
    .filter((j) => !ja.has(`${j.data}|${j.mandante}`))
    .filter((j) => { const k = `${j.data}|${j.mandante}`; if (vistos.has(k)) return false; vistos.add(k); return true; })
    .map((j) => ({
      data: j.data!, hora: j.hora, em_dias: j.em_dias!, mandante: j.mandante, visitante: j.visitante,
      campeonato: j.campeonato || 'Série A', motivos: [], contexto: '',
    }))
    .sort((a, b) => a.em_dias - b.em_dias);
}

export async function montarAgenda(env: Env, tabelas: Record<string, Tabela> = {}): Promise<Agenda> {
  const dias = Math.min(21, Math.max(1, Number(await lerConfig(env, 'agenda_dias')) || 10));
  const foco = ((await lerConfig(env, 'agenda_foco')) || 'Flamengo').split(',').map((s) => s.trim()).filter(Boolean);
  const [a, b] = await Promise.all([buscarCalendario(dias, SERIE_A), buscarCalendario(dias, SERIE_B)]);
  const falhas = [
    ...(a.ok ? [] : [`Série A: ${a.erro}`]),
    ...(b.ok ? [] : [`Série B: ${b.erro}`]),
  ];
  const todos = [...a.proximos, ...b.proximos];
  const jogos = escolherJogos(todos, foco, dias, tabelas);
  return { ok: a.ok || b.ok, dias, foco, jogos, outros: outrosJogos(todos, jogos, dias), falhas };
}

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function quandoLegivel(j: { data: string; hora: string | null; em_dias: number }): string {
  const [y, m, d] = j.data.split('-').map(Number);
  const dia = SEMANA[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  const rel = j.em_dias === 0 ? 'Hoje' : j.em_dias === 1 ? 'Amanhã' : '';
  const base = `${dia} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  return (rel ? `${rel}, ${base}` : base.charAt(0).toUpperCase() + base.slice(1)) + (j.hora ? ` · ${j.hora}` : '');
}

/** As linhas do card do Chat. Vazio quando não há jogo que interesse. */
export function linhasDaAgenda(a: Agenda | undefined | null, max = 8): string[] {
  if (!a || (!a.jogos.length && !a.outros?.length)) return [];
  const l = [`*📅 Jogos no radar — próximos ${a.dias} dias*`];
  if (!a.jogos.length) l.push(`_Nenhum jogo de ${a.foco.join('/') || 'foco'} nem entre dois licenciados na janela._`);
  for (const j of a.jogos.slice(0, max)) {
    const extra = [j.campeonato, ...j.motivos, j.contexto].filter(Boolean).join(' · ');
    l.push(`• *${quandoLegivel(j)}* — ${j.mandante} x ${j.visitante} _(${extra})_`);
  }
  if (a.jogos.length > max) l.push(`_…e mais ${a.jogos.length - max} na ata._`);
  if (a.outros?.length) {
    const curto = (j: JogoDaAgenda) => `${j.mandante} x ${j.visitante} (${quandoLegivel({ ...j, hora: null }).toLowerCase()})`;
    l.push(`_Também jogam:_ ${a.outros.slice(0, 6).map(curto).join(', ')}${a.outros.length > 6 ? '…' : ''}`);
  }
  return l;
}

/** O bloco que o comitê de coleção lê: a semana que vem, com o que está em jogo. */
export function formatarAgenda(a: Agenda): string {
  if (!a.jogos.length) return '';
  return [
    `━━ JOGOS DE CLUBE LICENCIADO NOS PRÓXIMOS ${a.dias} DIAS (Série A e B, globoesporte) ━━`,
    ...a.jogos.map((j) => `- ${j.data}${j.hora ? ' ' + j.hora : ''} (daqui a ${j.em_dias} dias): ${j.mandante} x ${j.visitante} — ` +
      [j.campeonato, ...j.motivos, j.contexto].filter(Boolean).join(', ')),
  ].join('\n');
}
