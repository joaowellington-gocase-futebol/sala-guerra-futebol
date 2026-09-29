// O CALENDÁRIO COMERCIAL — as datas em que o varejo brasileiro vende de verdade.
//
// Entrou em 29/09/2026 com o comitê de coleção (src/mercado/parecer.ts). A
// mesa só enxergava a rodada do Brasileirão, 14 dias à frente — e ninguém
// decide coleção olhando duas semanas. Um planejador de coleção começa pela
// pergunta "qual é a próxima data que justifica concentrar esforço?", e a
// resposta está aqui, em dias, calculada, não lembrada pelo modelo.
//
// As datas são as fixas do varejo e as móveis que se calculam (Black Friday,
// Dia dos Pais, Carnaval). Nada aqui é previsão: é calendário.

export interface DataComercial {
  data: string;      // AAAA-MM-DD
  nome: string;
  em_dias: number;
  /** O que a data costuma significar para quem vende presente e produto de torcida. */
  leitura: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d, 12));

/** Última sexta-feira de novembro. */
function blackFriday(ano: number): Date {
  const d = utc(ano, 11, 30);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** N-ésimo domingo de um mês. */
function domingo(ano: number, mes: number, n: number): Date {
  const d = utc(ano, mes, 1);
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7 * (n - 1));
  return d;
}

/** Páscoa (algoritmo de Meeus), base do Carnaval. */
function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(ano, mes, dia);
}

function datasDoAno(ano: number): { d: Date; nome: string; leitura: string }[] {
  const carnaval = pascoa(ano);
  carnaval.setUTCDate(carnaval.getUTCDate() - 47);
  return [
    { d: utc(ano, 1, 20), nome: 'Volta às aulas (janela)', leitura: 'mochila, garrafa e capinha nova; compra do pai para o filho torcedor' },
    { d: carnaval, nome: 'Carnaval', leitura: 'o país para; venda de produto de torcida esfria na semana' },
    { d: domingo(ano, 5, 2), nome: 'Dia das Mães', leitura: 'segunda maior data do varejo; pouco apelo para futebol masculino' },
    { d: utc(ano, 6, 12), nome: 'Dia dos Namorados', leitura: 'presente de casal; camisa e acessório de clube entram como presente para ele' },
    { d: domingo(ano, 8, 2), nome: 'Dia dos Pais', leitura: 'a data mais forte do ano para presente masculino e de torcida' },
    { d: utc(ano, 10, 12), nome: 'Dia das Crianças', leitura: 'kit infantil de clube; o pai compra o time dele para o filho' },
    { d: blackFriday(ano), nome: 'Black Friday', leitura: 'maior volume do ano, compra por desconto; favorece item de giro, não lançamento de narrativa' },
    { d: utc(ano, 12, 25), nome: 'Natal', leitura: 'presente de fim de ano; coleção fechada e kit presente performam melhor que peça solta' },
  ];
}

/** As datas comerciais dos próximos `janela` dias, mais o fim do campeonato quando ele cai dentro. */
export function proximasDatas(hoje: Date = new Date(), janela = 120, fimDoCampeonato?: string | null): DataComercial[] {
  const t0 = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate(), 12);
  const ano = hoje.getUTCFullYear();
  const todas = [...datasDoAno(ano), ...datasDoAno(ano + 1)];
  if (fimDoCampeonato && /^\d{4}-\d{2}-\d{2}$/.test(fimDoCampeonato)) {
    const [a, m, d] = fimDoCampeonato.split('-').map(Number);
    todas.push({
      d: utc(a, m, d), nome: 'Última rodada do Brasileirão',
      leitura: 'título, vaga e rebaixamento se decidem; é a única semana em que uma torcida inteira compra a mesma narrativa',
    });
  }
  return todas
    .map((x) => ({ data: iso(x.d), nome: x.nome, leitura: x.leitura, em_dias: Math.round((x.d.getTime() - t0) / 86400000) }))
    .filter((x) => x.em_dias >= 0 && x.em_dias <= janela)
    .sort((a, b) => a.em_dias - b.em_dias);
}

/**
 * O contexto do ano que um sênior teria na cabeça e o modelo não tem como
 * saber sozinho. Só fato datado — nada de opinião aqui.
 */
export const CONTEXTO_DO_ANO = [
  'A Copa do Mundo de 2026 terminou em 19/07/2026. O próximo grande ciclo de seleção está longe; o assunto de futebol no Brasil voltou a ser clube.',
  'No Brasil, as camisas novas da temporada seguinte dos clubes saem majoritariamente no primeiro semestre — o último trimestre é de camisa velha e de fim de campeonato.',
];

export function formatarCalendarioComercial(datas: DataComercial[]): string {
  if (!datas.length) return '';
  return [
    '━━ CALENDÁRIO COMERCIAL (as datas que o varejo brasileiro vende, contadas a partir de hoje) ━━',
    ...datas.map((d) => `- ${d.nome}: ${d.data}, daqui a ${d.em_dias} dias — ${d.leitura}`),
    '',
    'CONTEXTO DO ANO:',
    ...CONTEXTO_DO_ANO.map((c) => '- ' + c),
  ].join('\n');
}

export function numerosDoCalendario(datas: DataComercial[]): number[] {
  return datas.flatMap((d) => [d.em_dias, ...d.data.split('-').map(Number)]);
}
