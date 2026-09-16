// A mesa de investigação de mercado.
//
// O QUE MUDOU E POR QUÊ (correção do João, e ele tinha razão duas vezes):
//
// 1. A mesa não existe pra fazer capinha pro jogo de domingo. Ela existe pra
//    ENTENDER COMO O MERCADO ANDA. O antigo fluxo era uma linha de produção
//    (oportunidade → briefing → aprovação → tarefa) e por isso toda reunião
//    terminava num produto específico. Agora termina em ENTENDIMENTO: o que
//    passamos a acreditar sobre o mercado, e o que caiu por terra.
//
// 2. Eles não pensavam porque só recebiam o dado que eu tinha decidido buscar.
//    Comentar um relatório pronto não é pensar. Agora a mesa levanta várias
//    hipóteses CONCORRENTES, escreve o próprio SQL pra testar cada uma contra
//    a venda real, lê o que voltou e conclui — inclusive concluindo que estava
//    errada. Hipótese refutada é resultado tão bom quanto confirmada, e é
//    registrada com o mesmo destaque.
//
// 3. (15/09) O entendimento continua sendo o lastro, mas ele parou de ser o
//    FIM da reunião: a leitura daqui alimenta a rodada de DIREÇÃO, onde a mesa
//    diz ao João o que fazer com o que descobriu. Investigar sem recomendar
//    era a queixa dele — "vocês me explicam o mercado e não me dão direção".
//    Ver src/direcao.ts e a rodada 6 de src/reuniao.ts.
//
// O que sobrevive entre as rodadas são as CRENÇAS (tabela `crencas`): o modelo
// de mundo da mesa, que cresce, é revisado e às vezes desmorona. Toda
// investigação nova é obrigada a tentar derrubar pelo menos uma que está de pé
// — senão a mesa vira um clube de gente que concorda consigo mesma.

import type { Env } from './aiproxy';
import { chamarAgente, chamarAgenteTexto } from './aiproxy';
import { executarConsulta, formatarResultado, DICIONARIO } from './consulta';
import { PESSOAS, formatarPessoa } from './pessoas';

export interface Teste {
  pergunta: string;
  hipotese: string;
  sql: string;
  linhas: number;
  veredito: 'confirma' | 'refuta' | 'inconclusivo' | 'falhou';
  o_que_o_numero_diz: string;
  tentativas: number;
}

export interface Crenca { id?: number; afirmacao: string; evidencia: string; confianca: number }

export interface ResultadoInvestigacao {
  perguntas: { pergunta: string; hipotese: string; por_que_importa: string }[];
  testes: Teste[];
  passamosAAcreditar: Crenca[];
  caiuPorTerra: { afirmacao: string; por_que: string }[];
  emAberto: string[];
  leitura: string;
}

const MAX_PERGUNTAS = 4;

// ── As crenças que estão de pé ───────────────────────────────────────────

export async function crencasVivas(env: Env, limite = 12) {
  const q = await env.DB.query(
    "SELECT id, afirmacao, evidencia, confianca, vezes_confirmada FROM crencas WHERE status = 'viva' ORDER BY confianca DESC, id DESC LIMIT ?",
    [limite],
  );
  return q.rows.map((r) => ({
    id: Number(r.id), afirmacao: String(r.afirmacao), evidencia: String(r.evidencia || ''),
    confianca: Number(r.confianca || 0), vezes: Number(r.vezes_confirmada || 1),
  }));
}

function formatarCrencas(cs: { afirmacao: string; evidencia: string; confianca: number; vezes: number }[]): string {
  if (!cs.length) return 'A mesa ainda não acredita em nada sobre este mercado — esta é a primeira investigação.';
  return cs.map((c) =>
    `- "${c.afirmacao}" (confiança ${c.confianca.toFixed(1)}, confirmada ${c.vezes}x) — apoiada em: ${c.evidencia}`,
  ).join('\n');
}

// ── 1. As perguntas ──────────────────────────────────────────────────────

async function proporPerguntas(
  env: Env, contexto: string, crencas: string, naoRepita: string, direcao: string,
): Promise<{ pergunta: string; hipotese: string; por_que_importa: string }[]> {
  const r = await chamarAgente(
    env,
    'Você é a mesa de inteligência de mercado da Gocase para a linha de futebol — Téo (olheiro), Rafa (dados), ' +
    'Nina (criação), Caio (posicionamento) e Val (operação) pensando juntos.\n\n' +
    'O TRABALHO DE VOCÊS NÃO É decidir que produto lançar para um jogo específico. É ENTENDER COMO ESTE ' +
    'MERCADO SE COMPORTA — e, no fim da reunião, dizer ao João o que fazer com isso. Esta etapa aqui é a ' +
    'primeira metade: as perguntas.\n\n' +
    'Levante de 3 a ' + MAX_PERGUNTAS + ' PERGUNTAS sobre o mercado, para serem testadas AGORA contra a venda ' +
    'real. Cada uma vem com a sua hipótese: o que vocês apostam que vai aparecer no número.\n\n' +
    direcao +
    'O QUE FAZ UMA PERGUNTA PRESTAR AQUI:\n' +
    '• Ela é respondível por uma consulta à base de venda (um item vendido por linha, com produto, quantidade, ' +
    'preço, custo, categoria, tipo, cor, aparelho e data).\n' +
    '• Ela compara. "Quanto vendeu o Flamengo" não ensina nada; "clube grande e clube pequeno têm curva ' +
    'diferente depois de lançar uniforme" ensina.\n' +
    '• As perguntas são DIFERENTES ENTRE SI — ângulos que competem, não a mesma ideia reescrita. Se todas ' +
    'olham para o mesmo eixo, vocês vão confirmar o que já achavam.\n' +
    '• Pelo menos UMA tem que TENTAR DERRUBAR uma das crenças que a mesa já tem. Mesa que só busca confirmação ' +
    'não é mesa de inteligência, é torcida.\n' +
    '• Se a resposta puder mudar uma decisão do João, ela vale mais. Pergunta que só rende curiosidade não ' +
    'compete com pergunta que rende direção.\n' +
    '• Nada de pergunta cuja resposta você já sabe, e nada de pergunta genérica ("como está o mercado?").\n\n' +
    'O QUE A MESA JÁ ACREDITA (e você precisa desafiar):\n' + crencas + naoRepita +
    '\n\nResponda APENAS {"perguntas":[{"pergunta":"..","hipotese":"o que apostamos que o número vai mostrar",' +
    '"por_que_importa":"o que muda no negócio se isso for verdade"}]}',
    'Sinais e contexto de agora:\n' + contexto,
    undefined,
    0.75,
  );
  const d = r.ok ? (r.dados as any) : null;
  const lista = Array.isArray(d?.perguntas) ? d.perguntas : [];
  return lista.slice(0, MAX_PERGUNTAS).map((p: any) => ({
    pergunta: String(p?.pergunta || '').slice(0, 300),
    hipotese: String(p?.hipotese || '').slice(0, 300),
    por_que_importa: String(p?.por_que_importa || '').slice(0, 300),
  })).filter((p: any) => p.pergunta);
}

// ── 2. O teste: a Rafa escreve o SQL, roda, e lê o que voltou ────────────

/**
 * Tira o SQL de qualquer formato em que o modelo tenha resolvido responder.
 *
 * POR QUE ISTO EXISTE (João, 16/09/2026: "3 de 3 consultas não rodaram — não
 * consegui escrever a consulta"): a versão anterior pedia o SQL DENTRO de um
 * JSON (`{"sql":"..."}`). SQL é multilinha por natureza; quando o modelo emite
 * a quebra de linha de verdade em vez de \n, o JSON fica inválido, o cliente
 * cai no fallback de "resposta crua" e o campo `sql` chega vazio. Resultado: a
 * consulta nunca era escrita, nenhuma hipótese era testada, a mesa nunca tinha
 * número — e então era obrigada a dizer que não tinha o que recomendar. Todas
 * as atas vazias de dias seguidos passavam por aqui.
 *
 * Agora o SQL é pedido em texto puro, e este extrator ainda cobre as formas
 * em que ele costuma vir embrulhado.
 */
export function extrairSql(bruto: unknown): string {
  const texto = typeof bruto === 'string'
    ? bruto
    : String((bruto as any)?.sql || (bruto as any)?.texto || (bruto as any)?.resposta_crua || '');
  if (!texto.trim()) return '';

  // ```sql ... ```
  const cerca = texto.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (cerca?.[1]?.trim()) return cerca[1].trim();

  // {"sql": "..."} que não deu pra parsear
  const campo = texto.match(/"sql"\s*:\s*"([\s\S]*?)"\s*[,}]/);
  if (campo?.[1]?.trim()) {
    return campo[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, ' ').trim();
  }

  // O texto já é a consulta: corta o que vier antes do SELECT/WITH.
  const inicio = texto.search(/\b(select|with)\b/i);
  if (inicio >= 0) return texto.slice(inicio).trim();

  return '';
}

interface SqlEscrito { sql: string; erro?: string }

/**
 * A Rafa escreve a consulta. Em TEXTO, não em JSON — ver extrairSql acima.
 * Quando falha, devolve o motivo de verdade, porque "não consegui escrever a
 * consulta" sem causa foi exatamente o que escondeu este bug por dias.
 */
async function escreverSql(
  env: Env, pergunta: string, hipotese: string, erroAnterior?: string, sqlAnterior?: string,
): Promise<SqlEscrito> {
  const r = await chamarAgenteTexto(
    env,
    formatarPessoa('analista') +
    '\n\n━━ O QUE VOCÊ ESTÁ FAZENDO AGORA ━━\n' +
    'A mesa levantou uma pergunta sobre o mercado e você vai TESTAR contra a venda real. Escreva UMA consulta ' +
    'Postgres que responda essa pergunta de forma que dê pra concluir alguma coisa — com comparação, não com ' +
    'número solto.\n' + DICIONARIO +
    (erroAnterior
      ? `\n\n⚠ VOCÊ JÁ TENTOU E FALHOU. Sua consulta anterior foi:\n${sqlAnterior}\n\nO banco respondeu: ${erroAnterior}\n` +
        'Conserte. Se o erro for de coluna que não existe, use só as colunas do dicionário acima.'
      : '') +
    '\n\n━━ COMO RESPONDER ━━\n' +
    'Devolva SOMENTE a consulta SQL, em texto puro. Nada de JSON, nada de explicação, nada de comentário, ' +
    'nada de crase. A primeira palavra da sua resposta tem que ser SELECT ou WITH, e a última tem que ser o ' +
    'fim da consulta. Pode quebrar linha à vontade — é SQL, é pra ser legível.',
    [{ role: 'user', content: `Pergunta: ${pergunta}\nHipótese da mesa: ${hipotese}` }],
    0.25,
  );

  if (!r.ok) return { sql: '', erro: `o modelo não respondeu (${r.erro})` };
  const sql = extrairSql(r.dados);
  if (!sql) {
    const amostra = String((r.dados as any)?.texto || '').slice(0, 160).replace(/\s+/g, ' ');
    return { sql: '', erro: `o modelo respondeu sem consulta utilizável${amostra ? ` — começava com: "${amostra}"` : ''}` };
  }
  return { sql };
}

async function testarPergunta(
  env: Env, p: { pergunta: string; hipotese: string },
): Promise<Teste> {
  const primeira = await escreverSql(env, p.pergunta, p.hipotese);
  let sql = primeira.sql;
  let consulta = sql
    ? await executarConsulta(env, sql)
    : { ok: false, erro: primeira.erro || 'não consegui escrever a consulta', colunas: [], linhas: [], linhasRetornadas: 0 };
  let tentativas = 1;

  // Duas chances extras com o erro na mão — é o que uma pessoa faria, e é onde
  // mora boa parte do "pensar de verdade": ler o erro e corrigir. Eram duas
  // tentativas no total; virou três porque a rodada inteira depende disto, e
  // uma reunião sem número nenhum não vale o que custa.
  for (let n = 0; n < 2 && !consulta.ok; n++) {
    const nova = await escreverSql(env, p.pergunta, p.hipotese, consulta.erro, sql);
    tentativas += 1;
    if (!nova.sql) {
      consulta = { ok: false, erro: nova.erro || consulta.erro, colunas: [], linhas: [], linhasRetornadas: 0 };
      continue;
    }
    sql = nova.sql;
    consulta = await executarConsulta(env, sql);
  }

  if (!consulta.ok) {
    return {
      pergunta: p.pergunta, hipotese: p.hipotese, sql, linhas: 0, tentativas,
      veredito: 'falhou',
      o_que_o_numero_diz: `Não consegui testar: ${consulta.erro}`,
    };
  }

  const r = await chamarAgente(
    env,
    formatarPessoa('analista') +
    '\n\n━━ AGORA LEIA O QUE VOLTOU ━━\n' +
    'Você testou uma hipótese da mesa contra a venda real. Olhe as linhas e conclua, com a honestidade que é ' +
    'a sua marca registrada.\n' +
    'VEREDITO: "confirma" (o número sustenta a hipótese), "refuta" (o número diz o contrário — e isto é um ' +
    'resultado ÓTIMO, não um fracasso; a mesa aprende mais com hipótese derrubada do que com confirmada), ou ' +
    '"inconclusivo" (não deu pra saber com o que voltou, e forçar seria mentir).\n' +
    'Em "o_que_o_numero_diz" escreva UMA a TRÊS frases suas, com os números concretos que você viu. Sem ' +
    'adjetivo vazio. Se refutou, diga o que o número mostrou NO LUGAR da hipótese — é essa parte que vale ouro.\n' +
    'Cuidado com amostra pequena: se a comparação está apoiada em pouquíssimas unidades, o veredito é ' +
    '"inconclusivo" mesmo que o número pareça bonito. Você já se queimou com isso.\n' +
    '\nResponda APENAS {"veredito":"confirma|refuta|inconclusivo","o_que_o_numero_diz":"..."}',
    `Pergunta: ${p.pergunta}\nHipótese: ${p.hipotese}\n\nSQL que você escreveu:\n${consulta.sqlExecutado}\n\nO que voltou:\n${formatarResultado(consulta)}`,
    undefined,
    0.2,
  );
  const d = r.ok ? (r.dados as any) : null;
  const v = String(d?.veredito || 'inconclusivo');
  return {
    pergunta: p.pergunta, hipotese: p.hipotese, sql: consulta.sqlExecutado || sql,
    linhas: consulta.linhasRetornadas, tentativas,
    veredito: (['confirma', 'refuta', 'inconclusivo'].includes(v) ? v : 'inconclusivo') as Teste['veredito'],
    o_que_o_numero_diz: String(d?.o_que_o_numero_diz || 'não consegui ler o resultado').slice(0, 700),
  };
}

// ── 3. O que passamos a acreditar ────────────────────────────────────────

async function consolidar(
  env: Env, testes: Teste[], crencas: string,
): Promise<{ passamosAAcreditar: Crenca[]; caiuPorTerra: { afirmacao: string; por_que: string }[]; emAberto: string[]; leitura: string }> {
  const vazio = { passamosAAcreditar: [], caiuPorTerra: [], emAberto: [], leitura: 'Não consegui consolidar esta rodada.' };
  if (!testes.length) return vazio;

  const r = await chamarAgente(
    env,
    'Você está fechando a parte de INVESTIGAÇÃO de uma rodada da mesa de inteligência de mercado da Gocase ' +
    '(linha de futebol). A mesa se fez perguntas sobre COMO O MERCADO ANDA e testou cada uma contra a venda ' +
    'real. Seu trabalho é dizer o que a casa passa a entender.\n\n' +
    'REGRAS:\n' +
    '• "passamos_a_acreditar": só o que o NÚMERO sustenta, cada item com a evidência numérica colada e uma ' +
    'confiança de 0 a 1. Se nada foi confirmado, devolva lista vazia — sem prêmio de consolação.\n' +
    '• "caiu_por_terra": o que foi REFUTADO, incluindo crenças antigas da mesa que o teste derrubou. Esta é a ' +
    'parte mais valiosa da rodada: escreva com clareza o que a casa acreditava e o que o número mostrou no ' +
    'lugar.\n' +
    '• "em_aberto": o que ficou inconclusivo e merece ser testado de outro jeito na próxima — diga QUE OUTRO ' +
    'JEITO.\n' +
    '• "leitura": 3 a 5 frases, em português falado, como alguém explicando para o dono do negócio o que está ' +
    'acontecendo no mercado agora. Sem jargão, sem "recomenda-se". Se a rodada não ensinou nada, diga isso — é ' +
    'uma resposta honesta e acontece.\n' +
    '• Aqui é leitura de mercado, não plano de produto: a RECOMENDAÇÃO vem depois, numa etapa própria da ' +
    'reunião, e é lá que a mesa diz ao João o que fazer. Não antecipe plano nem cronograma neste campo.\n\n' +
    'O QUE A MESA JÁ ACREDITAVA ANTES DESTA RODADA:\n' + crencas +
    '\n\nResponda APENAS {"passamos_a_acreditar":[{"afirmacao":"..","evidencia":"..","confianca":0.0}],' +
    '"caiu_por_terra":[{"afirmacao":"..","por_que":".."}],"em_aberto":[".."],"leitura":".."}',
    testes.map((t) =>
      `PERGUNTA: ${t.pergunta}\nHIPÓTESE: ${t.hipotese}\nVEREDITO: ${t.veredito}\nO QUE O NÚMERO DISSE: ${t.o_que_o_numero_diz}`,
    ).join('\n\n———\n\n'),
    undefined,
    0.3,
  );
  if (!r.ok) return vazio;
  const d = r.dados as any;
  return {
    passamosAAcreditar: (Array.isArray(d?.passamos_a_acreditar) ? d.passamos_a_acreditar : []).map((c: any) => ({
      afirmacao: String(c?.afirmacao || '').slice(0, 400),
      evidencia: String(c?.evidencia || '').slice(0, 400),
      confianca: Math.max(0, Math.min(1, Number(c?.confianca ?? 0.5))),
    })).filter((c: Crenca) => c.afirmacao),
    caiuPorTerra: (Array.isArray(d?.caiu_por_terra) ? d.caiu_por_terra : []).map((c: any) => ({
      afirmacao: String(c?.afirmacao || '').slice(0, 400), por_que: String(c?.por_que || '').slice(0, 400),
    })).filter((c: any) => c.afirmacao),
    emAberto: (Array.isArray(d?.em_aberto) ? d.em_aberto : []).map((x: any) => String(x).slice(0, 300)),
    leitura: String(d?.leitura || vazio.leitura).slice(0, 1500),
  };
}

// ── O ciclo inteiro ──────────────────────────────────────────────────────

export async function investigarMercado(
  env: Env, opts: { sessao: string; contexto: string; naoRepita: string; direcao?: string },
): Promise<ResultadoInvestigacao> {
  const vivas = await crencasVivas(env);
  const textoCrencas = formatarCrencas(vivas);

  const perguntas = await proporPerguntas(env, opts.contexto, textoCrencas, opts.naoRepita, opts.direcao || '');
  if (!perguntas.length) {
    return { perguntas: [], testes: [], passamosAAcreditar: [], caiuPorTerra: [], emAberto: [], leitura: 'A mesa não conseguiu formular pergunta nenhuma nesta rodada.' };
  }

  // Cada pergunta é testada de forma independente — ângulos diferentes rodando
  // em paralelo é o oposto de uma linha de raciocínio única.
  const testes = await Promise.all(perguntas.map((p) => testarPergunta(env, p)));

  const agora = new Date().toISOString();
  for (const t of testes) {
    try {
      await env.DB.exec(
        'INSERT INTO investigacoes (sessao, pergunta, hipotese, sql_usado, linhas, veredito, o_que_o_numero_diz, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [opts.sessao, t.pergunta, t.hipotese, t.sql.slice(0, 4000), t.linhas, t.veredito, t.o_que_o_numero_diz, agora],
      );
    } catch { /* o registro é auxiliar */ }
  }

  const fim = await consolidar(env, testes, textoCrencas);

  // O modelo de mundo da mesa é atualizado: o que foi confirmado entra ou
  // ganha confiança; o que caiu é marcado como caído — e fica registrado, pra
  // ninguém ressuscitar sem evidência nova.
  try {
    for (const c of fim.passamosAAcreditar) {
      const existente = vivas.find((v) => v.afirmacao.toLowerCase().slice(0, 60) === c.afirmacao.toLowerCase().slice(0, 60));
      if (existente) {
        await env.DB.exec(
          'UPDATE crencas SET confianca = ?, evidencia = ?, revisada_em = ?, vezes_confirmada = vezes_confirmada + 1 WHERE id = ?',
          [Math.max(existente.confianca, c.confianca), c.evidencia, agora, existente.id],
        );
      } else {
        await env.DB.exec(
          "INSERT INTO crencas (afirmacao, evidencia, confianca, status, nascida_em, revisada_em) VALUES (?, ?, ?, 'viva', ?, ?)",
          [c.afirmacao, c.evidencia, c.confianca, agora, agora],
        );
      }
    }
    for (const q of fim.caiuPorTerra) {
      const alvo = vivas.find((v) => v.afirmacao.toLowerCase().slice(0, 40) === q.afirmacao.toLowerCase().slice(0, 40));
      if (alvo) {
        await env.DB.exec("UPDATE crencas SET status = 'caiu', evidencia = ?, revisada_em = ? WHERE id = ?",
          [q.por_que, agora, alvo.id]);
      }
    }
  } catch { /* a leitura da rodada vale mesmo se a gravação falhar */ }

  return { perguntas, testes, ...fim };
}
