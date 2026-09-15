// A conversa de corredor.
//
// Isto é o que faltava pra sala parecer viva, e é diferente de tudo que já
// existia aqui: não tem pauta, não tem entregável, ninguém pediu. Dois deles
// se cruzam no bebedouro e conversam — às vezes sobre trabalho, às vezes sobre
// a filha do Caio, às vezes sobre por que a Rafa não entende futebol.
//
// Por que isso melhora a informação, e não é só enfeite: numa agência de
// verdade, metade do que presta aparece assim. A Nina comenta de uma parede
// que fotografou, o Téo lembra de um jogo, e sai dali uma ideia que nenhuma
// reunião com pauta teria produzido. Quando a conversa rende algo concreto,
// ela vira pauta da próxima reunião — esse é o fio que liga o papo ao trabalho.
//
// Custo: UMA chamada de IA por conversa. Roda a cada 30 min pelo cron.

import type { Env } from './aiproxy';
import { chamarAgente } from './aiproxy';
import { PESSOAS, formatarPessoa } from './pessoas';
import { AGENTES } from './agentes';

export interface Conversa {
  a: string; b: string; assunto: string;
  falas: { quem: string; texto: string }[];
  rendeu: { vale_levar_pra_mesa: boolean; o_que: string } | null;
}

const CHAVES = AGENTES.map((a) => a.chave);

/** Estado atual de alguém: como chegou e o que não sai da cabeça. */
async function estadoDe(env: Env, chave: string) {
  const q = await env.DB.query(
    'SELECT humor, obsessao, o_que_me_trava FROM estado_agente WHERE chave = ?', [chave]);
  const r = q.rows[0];
  return {
    humor: String(r?.humor || ''),
    obsessao: String(r?.obsessao || ''),
    trava: String(r?.o_que_me_trava || ''),
  };
}

async function ultimaFalaDe(env: Env, chave: string): Promise<string> {
  const q = await env.DB.query('SELECT texto FROM falas WHERE chave = ? ORDER BY id DESC LIMIT 1', [chave]);
  return String(q.rows[0]?.texto || '');
}

/**
 * Escolhe quem conversa com quem. Não é sorteio puro: evita repetir a última
 * dupla, e dá peso pra quem tem atrito declarado — porque é entre essas duas
 * pessoas que a conversa rende mais.
 */
async function escolherDupla(env: Env): Promise<[string, string]> {
  const q = await env.DB.query('SELECT a, b FROM conversas ORDER BY id DESC LIMIT 3', []);
  const recentes = new Set(q.rows.map((r) => [String(r.a), String(r.b)].sort().join('|')));

  const pares: [string, string][] = [];
  for (let i = 0; i < CHAVES.length; i++) {
    for (let j = i + 1; j < CHAVES.length; j++) pares.push([CHAVES[i], CHAVES[j]]);
  }
  const disponiveis = pares.filter((p) => !recentes.has([...p].sort().join('|')));
  const pool = disponiveis.length ? disponiveis : pares;

  // Peso 2 pra dupla com atrito declarado na ficha de um dos dois.
  const pesado: [string, string][] = [];
  for (const [a, b] of pool) {
    pesado.push([a, b]);
    const atrito = PESSOAS[a]?.atritoCom.quem === PESSOAS[b]?.nome
      || PESSOAS[b]?.atritoCom.quem === PESSOAS[a]?.nome;
    if (atrito) pesado.push([a, b]);
  }
  return pesado[Math.floor(Math.random() * pesado.length)];
}

export async function conversaDeCorredor(env: Env): Promise<{ ok: boolean; detalhe: string; conversa?: Conversa }> {
  const [a, b] = await escolherDupla(env);
  const pa = PESSOAS[a], pb = PESSOAS[b];
  if (!pa || !pb) return { ok: false, detalhe: 'não achei as duas pessoas' };

  const [ea, eb, fa, fb, ultimasQ] = await Promise.all([
    estadoDe(env, a), estadoDe(env, b), ultimaFalaDe(env, a), ultimaFalaDe(env, b),
    env.DB.query('SELECT assunto FROM conversas ORDER BY id DESC LIMIT 6', []),
  ]);
  const jaFalaram = ultimasQ.rows.map((r) => String(r.assunto)).filter(Boolean);

  const system =
    'Você vai escrever uma CONVERSA DE CORREDOR entre dois colegas de uma agência interna de futebol da Gocase. ' +
    'Não é reunião. Ninguém pediu essa conversa e ela não tem pauta: os dois se cruzaram no bebedouro, na saída, ' +
    'esperando um café. Escreva o diálogo como diálogo real de gente que trabalha junto há tempo.\n\n' +
    'AS DUAS PESSOAS:\n' + formatarPessoa(a) + '\n\n— e —\n' + formatarPessoa(b) +
    '\n\n━━ COMO ESTÃO HOJE ━━\n' +
    `${pa.nome}: ${ea.humor || 'humor não registrado ainda'}. Não sai da cabeça dele(a): ${ea.obsessao || 'nada em especial'}.` +
    (ea.trava ? ` Está travado(a) em: ${ea.trava}.` : '') +
    ` A última coisa que disse numa reunião: "${fa || '—'}".\n` +
    `${pb.nome}: ${eb.humor || 'humor não registrado ainda'}. Não sai da cabeça dele(a): ${eb.obsessao || 'nada em especial'}.` +
    (eb.trava ? ` Está travado(a) em: ${eb.trava}.` : '') +
    ` A última coisa que disse numa reunião: "${fb || '—'}".\n` +
    '\n━━ COMO ESCREVER ━━\n' +
    '4 a 6 falas no total, curtas, alternando. Gente se interrompe, muda de assunto, deixa frase pela metade, ' +
    'faz piada interna. Pode ser sobre trabalho, pode ser sobre a vida — cozinha, cachorro, jogo de domingo, ' +
    'filha adolescente, a corrida de manhã. O melhor tipo de conversa aqui é a que começa numa coisa e termina ' +
    'em outra.\n' +
    'NÃO transforme isso em reunião. Ninguém apresenta resultado, ninguém pede prazo, ninguém fala "alinhar".\n' +
    'NÃO invente número de venda, notícia, placar ou data. Se o assunto passar por trabalho, fale do que já foi ' +
    'dito nas falas acima, ou do jeito vago com que gente fala no corredor ("aquele negócio do clássico").\n' +
    (jaFalaram.length
      ? `EVITE repetir estes assuntos, que já foram conversados nos últimos corredores: ${jaFalaram.join('; ')}.\n`
      : '') +
    '\n━━ SE RENDER ━━\n' +
    'Às vezes — não sempre, e nem na maioria das vezes — uma conversa dessas produz algo que vale a mesa saber: ' +
    'uma ideia, uma desconfiança, um problema que ninguém tinha contado. Se for o caso, preencha "rendeu". ' +
    'Se foi só conversa boa e não rendeu nada de trabalho, "vale_levar_pra_mesa" é false — e isso é o normal, ' +
    'não é fracasso. Conversa não precisa produzir pra valer a pena.\n' +
    '\nResponda APENAS {"assunto":"<do que falaram, em 4-6 palavras>","falas":[{"quem":"' + pa.nome + '|' + pb.nome +
    '","texto":"..."}],"rendeu":{"vale_levar_pra_mesa":bool,"o_que":"..."}}';

  const r = await chamarAgente(env, system, 'Escreva a conversa.', undefined, 0.95);
  if (!r.ok) return { ok: false, detalhe: 'o AI Proxy falhou: ' + r.erro };

  const d = r.dados as any;
  const falasBrutas: { quem?: string; texto?: string }[] = Array.isArray(d?.falas) ? d.falas : [];
  const falas = falasBrutas
    .filter((f) => f?.texto)
    .slice(0, 8)
    .map((f) => ({
      // Converte o nome de volta pra chave do agente, pra salinha saber quem fala.
      quem: String(f.quem || '').trim().toLowerCase() === pb.nome.toLowerCase() ? b : a,
      texto: String(f.texto).slice(0, 240),
    }));
  if (!falas.length) return { ok: false, detalhe: 'a conversa veio vazia' };

  const rendeu = d?.rendeu?.vale_levar_pra_mesa
    ? { vale_levar_pra_mesa: true, o_que: String(d.rendeu.o_que || '').slice(0, 400) }
    : null;

  try {
    await env.DB.exec(
      'INSERT INTO conversas (quando, a, b, assunto, falas, rendeu, aproveitada) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [new Date().toISOString(), a, b, String(d?.assunto || '').slice(0, 120),
       JSON.stringify(falas), rendeu ? rendeu.o_que : null],
    );
  } catch { /* a conversa aconteceu mesmo que o log falhe */ }

  return {
    ok: true,
    detalhe: `${pa.nome} e ${pb.nome} conversaram sobre ${d?.assunto || 'alguma coisa'}` + (rendeu ? ' — e rendeu' : ''),
    conversa: { a, b, assunto: String(d?.assunto || ''), falas, rendeu },
  };
}

/** O que os corredores produziram e a mesa ainda não aproveitou. Vira pauta. */
export async function pautasVindasDoCorredor(env: Env): Promise<{ id: number; quem: string; o_que: string }[]> {
  const q = await env.DB.query(
    'SELECT id, a, b, rendeu FROM conversas WHERE rendeu IS NOT NULL AND aproveitada = 0 ORDER BY id DESC LIMIT 4', []);
  return q.rows.map((r) => ({
    id: Number(r.id),
    quem: `${PESSOAS[String(r.a)]?.nome || r.a} e ${PESSOAS[String(r.b)]?.nome || r.b}`,
    o_que: String(r.rendeu || ''),
  }));
}

export async function marcarPautasAproveitadas(env: Env, ids: number[]) {
  for (const id of ids) {
    try { await env.DB.exec('UPDATE conversas SET aproveitada = 1 WHERE id = ?', [id]); } catch { /* auxiliar */ }
  }
}

export async function conversasRecentes(env: Env, limite = 8) {
  const q = await env.DB.query(
    'SELECT id, quando, a, b, assunto, falas, rendeu FROM conversas ORDER BY id DESC LIMIT ?', [limite]);
  return q.rows.map((r) => {
    let falas: unknown = [];
    try { falas = JSON.parse(String(r.falas || '[]')); } catch { falas = []; }
    return { id: r.id, quando: r.quando, a: r.a, b: r.b, assunto: r.assunto, falas, rendeu: r.rendeu };
  });
}
