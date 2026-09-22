// O PLACAR — a prestação de contas da rodada anterior.
//
// É o que impede a mesa de ser opinião recorrente: toda reunião ABRE cobrando
// a si mesma. Sem isso, uma leitura ruim custa o mesmo que uma boa, e nada
// pressiona por qualidade.
//
// ━━ O QUE MUDOU EM 22/09/2026 ━━
//
// O placar media a procura do CLUBE citado na recomendação da véspera. Com a
// virada para leitura de mercado (src/mercado/leitura.ts), a entrega deixou de
// citar clube — e o placar teria ficado mudo, repetindo "a recomendação não
// citava clube, não há o que medir" todo dia.
//
// A cobrança agora é outra, e é mais justa: cada leitura declara O QUE
// CONFIRMARIA OU DERRUBARIA ELA na rodada seguinte. O placar pega essa promessa
// e a devolve com o número de HOJE ao lado — a família que a leitura citou, com
// o valor que ela afirmou e o valor medido agora. A mesa não pode mais fingir
// que nunca disse nada.
//
// O que isto NÃO é: prova de que a casa vendeu. É a régua de calibragem da
// leitura de mercado — e o texto abaixo diz isso na cara, em vez de fingir um
// mérito que não dá pra provar daqui.

import type { Env } from './aiproxy';
import type { MapaDeDemanda } from './mercado/demanda';
import { numerosDoTexto, normalizar } from './juiz';

export interface LeituraCobrada {
  o_que: string;
  o_que_confirma: string;
  confianca: string;
  /** As famílias que a leitura citou e o que elas mediam quando ela foi escrita. */
  familias: { familia: string; entao: number | null; agora: number | null }[];
  numerosDeEntao: number[];
}

export interface Placar {
  houve: boolean;
  dias: number;
  quando: string;
  cobradas: LeituraCobrada[];
}

/** Quais famílias do mapa de hoje a leitura da véspera mencionou. */
function familiasCitadas(texto: string, mapa: MapaDeDemanda): string[] {
  const t = normalizar(texto);
  return mapa.familias.map((f) => f.familia).filter((f) => t.includes(normalizar(f)));
}

export async function medirLeiturasAnteriores(env: Env, mapa: MapaDeDemanda): Promise<Placar> {
  const q = await env.DB.query(
    "SELECT quando, leituras FROM atas WHERE leituras IS NOT NULL AND leituras != '[]' ORDER BY quando DESC LIMIT 1",
    [],
  );
  const linha = q.rows[0];
  if (!linha) return { houve: false, dias: 0, quando: '', cobradas: [] };

  let ls: any[] = [];
  try { ls = JSON.parse(String(linha.leituras || '[]')); } catch { ls = []; }
  if (!ls.length) return { houve: false, dias: 0, quando: '', cobradas: [] };

  const quando = String(linha.quando || '');
  const dias = Math.max(0, Math.round((Date.now() - new Date(quando).getTime()) / 86400000));

  const cobradas: LeituraCobrada[] = ls.map((l) => {
    const o_que = String(l?.o_que_o_mercado_pede || '');
    const evidencia = String(l?.evidencia || '');
    const numerosDeEntao = numerosDoTexto(evidencia);
    const familias = familiasCitadas(o_que + ' ' + evidencia, mapa).map((familia) => {
      const hoje = mapa.familias.find((f) => f.familia === familia);
      // "Então" é o número que a leitura afirmou sobre a família; o mais
      // próximo do valor de hoje é o candidato honesto — a mesa cita vários
      // números por leitura e não diz qual é qual.
      const agora = hoje ? hoje.novos_45d : null;
      const entao = agora === null
        ? null
        : numerosDeEntao.reduce<number | null>(
            (melhor, n) => (melhor === null || Math.abs(n - agora) < Math.abs(melhor - agora) ? n : melhor),
            null,
          );
      return { familia, entao, agora };
    });
    return {
      o_que,
      o_que_confirma: String(l?.o_que_confirma || ''),
      confianca: String(l?.confianca || ''),
      familias,
      numerosDeEntao,
    };
  });

  return { houve: true, dias, quando, cobradas };
}

export function formatarPlacar(p: Placar): string {
  if (!p.houve) {
    return 'PRESTAÇÃO DE CONTAS: esta é a primeira rodada com leitura de mercado — não há nada da véspera pra cobrar ainda.';
  }

  const linhas = p.cobradas.map((c) => {
    const movimento = c.familias.length
      ? c.familias.map((f) => {
          if (f.agora === null) return `${f.familia}: não medida hoje`;
          if (f.entao === null) return `${f.familia}: ${f.agora} lançamentos/45d hoje (sem número comparável na leitura)`;
          const delta = f.agora - f.entao;
          const sinal = delta > 0 ? `+${delta}` : String(delta);
          return `${f.familia}: você disse ${f.entao}, hoje são ${f.agora} (${sinal})`;
        }).join(' · ')
      : 'a leitura não citou família que o mapa de hoje meça';
    return (
      `- "${c.o_que.slice(0, 150)}" (confiança declarada: ${c.confianca})\n` +
      `  VOCÊS DISSERAM QUE CONFIRMARIA: ${c.o_que_confirma || '(não disseram — e isso já é uma falha)'}\n` +
      `  O NÚMERO DE HOJE: ${movimento}`
    );
  }).join('\n');

  return (
    `PRESTAÇÃO DE CONTAS — a leitura de ${p.dias === 0 ? 'hoje mais cedo' : `${p.dias} dia(s) atrás`} e o que ` +
    `o dado fez desde então:\n${linhas}\n` +
    'COMO USAR ISTO: a primeira coisa da rodada de hoje é responder se aquilo confirmou, mudou de forma ou ' +
    'caiu — com o número na mão. Se caiu, digam que caiu: leitura derrubada por dado novo é o melhor ' +
    'resultado que esta mesa produz, e é o que faz a próxima valer alguma coisa. O que não vale é seguir ' +
    'adiante como se a rodada de ontem não tivesse existido.'
  );
}
