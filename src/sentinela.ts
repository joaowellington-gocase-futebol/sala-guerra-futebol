// A SENTINELA — quem avisa quando a mesa cala.
//
// POR QUE (João, 22/09/2026, ao escolher o que melhorar na entrega): hoje, se
// o cron falha, se a reunião estoura o tempo do Worker ou se a mesa passa dias
// sem conseguir entregar leitura nenhuma, o app simplesmente fica quieto. E
// silêncio é ambíguo: é igualzinho a "não houve nada demais hoje". A pessoa só
// descobre que parou quando vai procurar — e aí já são dias.
//
// A regra que orienta o que entra aqui: a sentinela só fala quando há ALGO
// ERRADO. Ela nunca manda "está tudo bem" — um canal que recebe alerta todo
// dia é um canal que ninguém lê, e o custo disso é justamente não ver o dia em
// que era de verdade.
//
// As três coisas que ela vigia, todas verificáveis no banco, sem IA:
//
//   SILÊNCIO   nenhuma reunião completa há mais de 26 horas. O cron é diário
//              às 11:00 UTC, então 26h dá folga pra uma rodada atrasar sem
//              acusar falso.
//   MUDEZ      as últimas rodadas completas terminaram sem leitura aprovada.
//              A mesa está rodando e não está entregando — que é pior que não
//              rodar, porque consome chamada de IA e não produz nada.
//   MARCHA     as últimas rodadas foram todas de revisão. Quer dizer que nada
//              muda nas fontes há dias: ou o mundo parou, ou uma fonte caiu e
//              está devolvendo sempre a mesma coisa.
//
// Para não virar despertador quebrado, o mesmo alerta não se repete: a
// sentinela guarda em config o que avisou por último e só volta a falar quando
// o diagnóstico muda.

import type { Env } from './aiproxy';
import { lerConfig, gravarConfig } from './db';
import { mandarAvisoCurto } from './webhook';

/** Horas sem reunião completa antes de acusar silêncio. O cron é diário. */
const HORAS_ATE_ACUSAR = 26;

/** Quantas rodadas seguidas sem leitura antes de acusar mudez. */
const RODADAS_MUDAS = 3;

export interface Diagnostico {
  /** 'ok' = nada a dizer, e nesse caso a sentinela não fala. */
  estado: 'ok' | 'silencio' | 'mudez' | 'marcha';
  titulo: string;
  detalhe: string;
  oQueFazer: string;
}

export async function diagnosticar(env: Env): Promise<Diagnostico> {
  const ok: Diagnostico = { estado: 'ok', titulo: '', detalhe: '', oQueFazer: '' };

  const ultimas = await env.DB.query(
    'SELECT quando, modo, leituras, tema FROM atas ORDER BY quando DESC LIMIT ?', [RODADAS_MUDAS + 2]);
  const linhas = ultimas.rows;

  if (!linhas.length) {
    return {
      estado: 'silencio',
      titulo: 'A mesa nunca se reuniu',
      detalhe: 'Não há nenhuma ata no banco.',
      oQueFazer: 'Rode uma reunião à mão pelo painel (📣 Convocar) e veja se ela fecha.',
    };
  }

  const maisRecente = String(linhas[0].quando || '');
  const horas = (Date.now() - new Date(maisRecente).getTime()) / 3600000;
  if (!isFinite(horas) || horas > HORAS_ATE_ACUSAR) {
    return {
      estado: 'silencio',
      titulo: 'A mesa não se reuniu',
      detalhe: `A última reunião foi há ${Math.round(horas)} horas (a automática roda uma vez por dia, às 8h de Fortaleza).`,
      oQueFazer: 'Veja os logs do app: o cron pode ter falhado, ou a reunião pode estar estourando o tempo do Worker.',
    };
  }

  const completas = linhas.filter((l) => String(l.modo || 'completa') === 'completa');
  const semLeitura = completas.filter((l) => {
    const cru = String(l.leituras || '[]');
    try { return !(JSON.parse(cru) as unknown[]).length; } catch { return true; }
  });
  if (completas.length >= RODADAS_MUDAS && semLeitura.length >= RODADAS_MUDAS) {
    return {
      estado: 'mudez',
      titulo: 'A mesa está rodando e não está entregando',
      detalhe: `As últimas ${semLeitura.length} reuniões completas terminaram sem nenhuma leitura aprovada na conferência.`,
      oQueFazer: 'Abra a ata e veja a seção "Barradas na conferência": o motivo das reprovações diz se a régua ' +
        'está apertada demais ou se uma fonte de dado parou de chegar.',
    };
  }

  const revisoes = linhas.filter((l) => String(l.modo || '') === 'revisao');
  if (linhas.length >= RODADAS_MUDAS && revisoes.length === linhas.length) {
    return {
      estado: 'marcha',
      titulo: 'Nada muda lá fora há dias',
      detalhe: `As últimas ${revisoes.length} rodadas foram todas de revisão — as fontes devolveram sempre a mesma coisa.`,
      oQueFazer: 'Provavelmente uma fonte caiu e está repetindo a resposta. Confira o rodapé da ata, onde ficam ' +
        'as fontes com falha da rodada.',
    };
  }

  return ok;
}

export interface ResultadoSentinela {
  ok: boolean;
  estado: Diagnostico['estado'];
  avisou: boolean;
  detalhe: string;
}

export async function vigiar(env: Env, origem: string): Promise<ResultadoSentinela> {
  const d = await diagnosticar(env);

  if (d.estado === 'ok') {
    // Volta a poder avisar quando o problema seguinte aparecer.
    await gravarConfig(env, 'sentinela_ultimo', '');
    return { ok: true, estado: 'ok', avisou: false, detalhe: 'nada a reportar — a mesa está rodando e entregando' };
  }

  // O mesmo alerta não se repete: um canal que recebe o mesmo aviso todo dia
  // deixa de ser lido, e aí o dia em que era grave passa batido também.
  const jaAvisado = await lerConfig(env, 'sentinela_ultimo');
  if (jaAvisado === d.estado) {
    return { ok: true, estado: d.estado, avisou: false, detalhe: `já avisei sobre "${d.estado}" e nada mudou desde então` };
  }

  const entrega = await mandarAvisoCurto(env, [
    `*⚠ Sala de Guerra — ${d.titulo}*`,
    '',
    d.detalhe,
    '',
    `*O que fazer:* ${d.oQueFazer}`,
    '',
    `<${origem}/index.html|🕹 Abrir a sala>`,
  ]);

  if (entrega.ok) await gravarConfig(env, 'sentinela_ultimo', d.estado);
  return { ok: entrega.ok, estado: d.estado, avisou: entrega.ok, detalhe: entrega.detalhe };
}
