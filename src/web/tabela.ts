// A TABELA DO BRASILEIRÃO — quem briga por quê a esta altura do campeonato.
//
// Entrou em 29/09/2026 com o comitê de coleção (src/mercado/parecer.ts). A mesa
// via jogo e procura, mas não via a CLASSIFICAÇÃO, e é ela que decide coleção
// no último terço do ano: título, vaga e rebaixamento são os únicos gatilhos
// que fazem uma torcida inteira comprar a mesma narrativa na mesma semana.
// Jogo de domingo vende drop; título vende coleção.
//
// A conta de "ainda briga" é código, não modelo: pontos e rodadas restantes
// são aritmética, e o modelo erra aritmética com convicção.

import { pegarJson } from './http';
import { SERIE_A, type Campeonato } from './calendario';

export type Situacao =
  | 'lider' | 'briga_titulo' | 'vaga_libertadores' | 'meio' | 'risco_rebaixamento' | 'zona_rebaixamento';

export interface ClubeNaTabela {
  posicao: number;
  clube: string;
  pontos: number;
  jogos: number;
  restantes: number;
  /** Pontos atrás do líder (0 para o líder). */
  atras_do_lider: number;
  /** Pontos acima do 17º colocado, o primeiro da zona (0 ou menos = dentro dela). */
  acima_do_z4: number;
  ultimos5: string;
  situacao: Situacao;
  /** 'embalado' com 4+ vitórias nos últimos 5; 'em_queda' com 3+ derrotas. */
  momento: 'embalado' | 'em_queda' | 'normal';
}

export interface Tabela {
  ok: boolean;
  campeonato: string;
  fim: string | null;
  rodada: number | null;
  clubes: ClubeNaTabela[];
  erro?: string;
}

interface Bruto {
  edicao?: { nome?: string; data_fim?: string };
  rodada?: { atual?: number };
  classificacao?: {
    ordem: number; nome_popular: string; pontos: number; jogos: number; ultimos_jogos?: string[];
  }[];
}

const RODADAS = 38;
/** Distância que a esta altura ainda é briga de verdade, não só matemática. */
const BRIGA = 9;

export function classificar(linhas: Bruto['classificacao']): ClubeNaTabela[] {
  const l = (linhas || []).filter((x) => x && x.nome_popular).sort((a, b) => a.ordem - b.ordem);
  if (!l.length) return [];
  const lider = l[0].pontos;
  // O 17º é o primeiro da zona. Quem está acima dele por pouco está em risco.
  const primeiroDoZ4 = l[16]?.pontos ?? 0;
  return l.map((c) => {
    const restantes = Math.max(0, RODADAS - c.jogos);
    const atras = lider - c.pontos;
    const acima = c.pontos - primeiroDoZ4;
    const u = (c.ultimos_jogos || []).slice(-5);
    const vit = u.filter((x) => x === 'v').length;
    const der = u.filter((x) => x === 'd').length;
    let situacao: Situacao = 'meio';
    if (c.ordem === 1) situacao = 'lider';
    else if (atras <= BRIGA && atras <= restantes * 3) situacao = 'briga_titulo';
    else if (c.ordem >= 17) situacao = 'zona_rebaixamento';
    else if (acima <= 4) situacao = 'risco_rebaixamento';
    else if (c.ordem <= 6) situacao = 'vaga_libertadores';
    return {
      posicao: c.ordem, clube: c.nome_popular, pontos: c.pontos, jogos: c.jogos, restantes,
      atras_do_lider: atras, acima_do_z4: acima,
      ultimos5: u.join('').toUpperCase(),
      situacao,
      momento: vit >= 4 ? 'embalado' : der >= 3 ? 'em_queda' : 'normal',
    };
  });
}

export async function buscarTabela(camp: Campeonato = SERIE_A): Promise<Tabela> {
  const url = `https://api.globoesporte.globo.com/tabela/${camp.id}/classificacao/`;
  const r = await pegarJson<Bruto>(url, 12000);
  if (!r.ok || !r.dados?.classificacao?.length) {
    return { ok: false, campeonato: 'Brasileirão', fim: null, rodada: null, clubes: [], erro: r.erro || 'sem classificação' };
  }
  return {
    ok: true,
    campeonato: r.dados.edicao?.nome || 'Brasileirão',
    fim: r.dados.edicao?.data_fim ? String(r.dados.edicao.data_fim).slice(0, 10) : null,
    rodada: r.dados.rodada?.atual ?? null,
    clubes: classificar(r.dados.classificacao),
  };
}

const ROTULO: Record<Situacao, string> = {
  lider: 'LÍDER',
  briga_titulo: 'briga pelo título',
  vaga_libertadores: 'zona de Libertadores',
  meio: 'meio da tabela',
  risco_rebaixamento: 'RISCO de rebaixamento',
  zona_rebaixamento: 'DENTRO da zona de rebaixamento',
};

/** Só o que interessa a uma decisão de coleção: as pontas da tabela e quem mudou de ritmo. */
export function formatarTabela(t: Tabela): string {
  if (!t.ok) return `TABELA DO BRASILEIRÃO: não carregou (${t.erro}).`;
  const restantes = t.clubes[0]?.restantes ?? 0;
  const linha = (c: ClubeNaTabela) =>
    `- ${c.posicao}º ${c.clube}: ${c.pontos} pts em ${c.jogos} jogos` +
    (c.atras_do_lider ? `, ${c.atras_do_lider} atrás do líder` : '') +
    ` — ${ROTULO[c.situacao]}` +
    (c.momento === 'embalado' ? ' · EMBALADO (últimos 5: ' + c.ultimos5 + ')' : '') +
    (c.momento === 'em_queda' ? ' · EM QUEDA (últimos 5: ' + c.ultimos5 + ')' : '');
  const pontaDeCima = t.clubes.filter((c) => c.situacao === 'lider' || c.situacao === 'briga_titulo');
  const pontaDeBaixo = t.clubes.filter((c) => c.situacao === 'risco_rebaixamento' || c.situacao === 'zona_rebaixamento');
  const ritmo = t.clubes.filter((c) => c.momento !== 'normal' && !pontaDeCima.includes(c) && !pontaDeBaixo.includes(c));
  return [
    `━━ TABELA DO ${t.campeonato.toUpperCase()} (globoesporte, agora) ━━`,
    `Faltam ${restantes} rodadas; o campeonato termina em ${t.fim || 'data não informada'}.`,
    'DISPUTA DE TÍTULO:', ...pontaDeCima.map(linha),
    'RISCO DE REBAIXAMENTO:', ...pontaDeBaixo.map(linha),
    ritmo.length ? 'MUDANÇA DE RITMO NO MEIO DA TABELA:' : '', ...ritmo.map(linha),
  ].filter(Boolean).join('\n');
}

export function numerosDaTabela(t: Tabela): number[] {
  return t.clubes.flatMap((c) => [c.posicao, c.pontos, c.jogos, c.restantes, c.atras_do_lider, Math.abs(c.acima_do_z4)]);
}
