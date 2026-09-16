// O MUNDO LÁ FORA — a coleta única da reunião, e o recorte que cada um recebe.
//
// Desenho que veio do pedido do João em 16/09/2026 ("desvincule todos os
// agentes ligados aos deploys, procurem dados na internet real"): nenhuma
// fonte aqui é app nosso. Tudo é internet aberta, sem chave, consultada no
// momento da reunião.
//
// E tem uma segunda ideia embutida, que é o que separa uma equipe de um
// relatório: CADA UM RECEBE UMA COISA DIFERENTE. O Téo não vê o feed de design
// da Nina, e a Nina não vê a tabela do Brasileirão. Quando todo mundo lê o
// mesmo dossiê, todo mundo chega na mesma conclusão e a reunião vira eco — foi
// o que aconteceu enquanto as cinco pessoas liam o mesmo JSON. Discordância só
// existe quando as pessoas viram coisas diferentes.
//
// O que cada um enxerga:
//   Téo (olheiro)     calendário real + curva de procura + assunto dos clubes
//   Nina (criação)    uniformes do mundo, design fora do futebol, cultura pop
//   Caio (marketeiro) o que a concorrência licenciada lançou, com marca e data
//   Rafa (analista)   nada daqui: a fonte dela é a venda da casa, no datamart
//   Val (produtor)    nada daqui: a fonte dela é a fila de pedidos

import { buscarCalendario, formatarCalendario, clubesEmJogo, type Calendario } from './calendario';
import { buscarProcura, formatarProcura, type Procura } from './procura';
import { buscarEstetica, formatarEstetica, type Estetica } from './estetica';
import { buscarNoticiasDoMercado, formatarNoticiasDoMercado, type NoticiasDoMercado } from './noticias';
import { buscarTorcida, formatarTorcida, type Torcida } from './torcida';

export interface Mundo {
  calendario: Calendario;
  procura: Procura;
  estetica: Estetica;
  noticias: NoticiasDoMercado;
  torcida: Torcida;
  clubesEmJogo: string[];
  falhas: string[];
}

/**
 * Uma coleta por reunião, em duas ondas: o calendário primeiro, porque é ele
 * que diz QUAIS CLUBES importam hoje — e as buscas seguintes se apertam em
 * volta desses clubes em vez de varrer os 18.
 */
export async function buscarMundo(): Promise<Mundo> {
  const calendario = await buscarCalendario(14);
  const emJogo = clubesEmJogo(calendario);

  const [procura, estetica, noticias, torcida] = await Promise.all([
    buscarProcura(emJogo),
    buscarEstetica(),
    buscarNoticiasDoMercado(emJogo),
    buscarTorcida(),
  ]);

  const falhas = [
    ...(calendario.ok ? [] : [`calendário: ${calendario.erro}`]),
    ...procura.falhas,
    ...estetica.falhas,
    ...noticias.falhas,
    ...torcida.falhas,
  ];

  return { calendario, procura, estetica, noticias, torcida, clubesEmJogo: emJogo, falhas };
}

/** O recorte de cada um. Vazio quando a fonte do agente não é a internet. */
export function dossieDe(chave: string, m: Mundo): string {
  switch (chave) {
    case 'olheiro':
      return [
        formatarCalendario(m.calendario),
        formatarProcura({ ...m.procura, temas: [] }),
        m.noticias.clubes.length
          ? 'O ASSUNTO DOS CLUBES QUE JOGAM AGORA (imprensa, últimos 21 dias):\n' +
            m.noticias.clubes.map((i) => `- ${i.titulo} · ${i.link}`).join('\n')
          : '',
        m.torcida.ok
          ? formatarTorcida(m.torcida)
          : '',
      ].filter(Boolean).join('\n\n');

    case 'criacao':
      return [
        formatarEstetica(m.estetica),
        m.noticias.uniformes.length
          ? 'CAMISA NOVA NO BRASIL (o gatilho de estampa mais forte que existe):\n' +
            m.noticias.uniformes.map((i) => `- ${i.titulo} · ${i.link}`).join('\n')
          : '',
        formatarProcura({ ...m.procura, clubes: [] }),
      ].filter(Boolean).join('\n\n');

    case 'marketeiro':
      return [
        formatarNoticiasDoMercado({ ...m.noticias, clubes: [] }),
        formatarProcura({ ...m.procura, temas: [] }),
      ].filter(Boolean).join('\n\n');

    default:
      return '';
  }
}

/** O pedaço que a mesa inteira vê — o mínimo pra todo mundo estar no mesmo dia. */
export function resumoDoMundo(m: Mundo): string {
  const jogos = m.calendario.proximos.slice(0, 6)
    .map((j) => `${j.mandante} x ${j.visitante} em ${j.data}${j.classico ? ' ⚔' : ''} (${j.em_dias}d)`)
    .join(' | ');
  const sobe = m.procura.clubes.filter((c) => (c.variacao_pct ?? 0) > 10)
    .map((c) => `${c.clube} +${c.variacao_pct}%`).join(', ');
  const cultura = m.procura.temas.filter((t) => t.tipo === 'cultura').slice(0, 6)
    .map((t) => t.titulo).join(', ');

  return [
    jogos ? `JOGOS NA JANELA: ${jogos}` : 'JOGOS NA JANELA: nenhum.',
    sobe ? `PROCURA SUBINDO: ${sobe}` : 'PROCURA: nenhum clube subindo de forma relevante.',
    cultura ? `CULTURA POP EM ALTA NO BRASIL: ${cultura}` : '',
    m.noticias.concorrencia.length
      ? `A CONCORRÊNCIA LANÇOU: ${m.noticias.concorrencia.slice(0, 4).map((i) => i.titulo.slice(0, 80)).join(' | ')}`
      : '',
    m.falhas.length ? `(fontes com falha: ${m.falhas.join('; ')})` : '',
  ].filter(Boolean).join('\n');
}
