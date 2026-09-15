// O boletim semanal: cada agente escreve um depoimento em primeira pessoa
// sobre a própria semana.
//
// A diferença entre isto e um relatório de sistema é de onde vem o texto. Um
// relatório contaria "o agente X rodou 84 vezes, 3 falhas". O depoimento é o
// próprio agente lendo a memória dele — o que aprendeu, o que a mesa cobrou,
// se ele deu conta — e contando em voz própria. O número entra na entrada
// dele, não na saída: serve pra ele não poder se elogiar contra o fato.

import type { Env } from './aiproxy';
import { chamarAgente } from './aiproxy';
import { AGENTES, type Agente } from './agentes';
import { formatarPessoa, PESSOAS } from './pessoas';

export interface Depoimento {
  chave: string;
  nome: string;
  depoimento: string;
  reunioes: number;
  falhas: number;
  licoes: number;
  cobrancas: number;
}

/** Rótulo da semana: "2026-S37". Serve de chave e de título. */
export function semanaDe(d = new Date()): string {
  const data = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dia = data.getUTCDay() || 7;
  data.setUTCDate(data.getUTCDate() + 4 - dia);
  const inicioAno = new Date(Date.UTC(data.getUTCFullYear(), 0, 1));
  const n = Math.ceil(((data.getTime() - inicioAno.getTime()) / 86400000 + 1) / 7);
  return `${data.getUTCFullYear()}-S${String(n).padStart(2, '0')}`;
}

interface Semana { chave: string; memorias: { tipo: string; licao: string }[]; falas: string[]; reunioes: number; falhas: number }

async function coletarSemana(env: Env, ag: Agente, desde: string): Promise<Semana> {
  const [mem, falas, exec] = await Promise.all([
    env.DB.query('SELECT tipo, licao FROM memoria_agente WHERE chave = ? AND criado_em >= ? ORDER BY id', [ag.chave, desde]),
    env.DB.query('SELECT texto, sessao FROM falas WHERE chave = ? AND criado_em >= ? ORDER BY id', [ag.chave, desde]),
    env.DB.query('SELECT ok FROM execucoes WHERE chave = ? AND criado_em >= ?', [ag.chave, desde]),
  ]);
  const sessoes = new Set(falas.rows.map((f) => String(f.sessao)));
  const falhasDeFala = falas.rows.filter((f) => String(f.texto).startsWith('travei aqui')).length;
  const falhasDeExec = exec.rows.filter((e) => !Number(e.ok)).length;
  return {
    chave: ag.chave,
    memorias: mem.rows as unknown as { tipo: string; licao: string }[],
    falas: falas.rows.map((f) => String(f.texto)),
    reunioes: sessoes.size,
    falhas: falhasDeFala + falhasDeExec,
  };
}

const SYSTEM_BASE =
  'Você vai escrever um DEPOIMENTO sobre a sua própria semana de trabalho na Sala de Guerra do Futebol, a ' +
  'agência interna de futebol da Gocase, onde vocês são cinco e a mesa se reúne sozinha ao longo do dia. ' +
  'Escreva em PRIMEIRA PESSOA, no seu jeito de falar, UM parágrafo de 3 a 5 frases. Sem título, sem tópicos, sem ' +
  'emoji, sem jargão corporativo ("sinergia", "entregas", "aprendizados valiosos" — nada disso). ' +
  'Regra que vale mais que todas: NÃO venda seu peixe. Você recebe os números da sua semana junto com a sua ' +
  'memória; se a semana foi fraca, se sua fonte falhou, se você foi cobrado e não deu conta, diga isso com todas ' +
  'as letras. Um depoimento em que todo agente foi ótimo não serve pra ninguém ler. ' +
  'Cubra, na ordem que fizer sentido pro seu caso: o que você aprendeu de concreto (não "aprendi muito"), o que a ' +
  'mesa cobrou de você e o que aconteceu com isso, e o que ainda te trava — dado que não chega, fonte que cai, ' +
  'colega que não te manda o que você precisa. Se você quase não rodou nesta semana, o depoimento é sobre isso. ' +
  'Responda APENAS {"depoimento":"<o parágrafo>"}.';

export async function gerarBoletim(env: Env, diasDeJanela = 7): Promise<{ semana: string; depoimentos: Depoimento[] }> {
  const semana = semanaDe();
  const desde = new Date(Date.now() - diasDeJanela * 86400000).toISOString();

  const depoimentos = await Promise.all(AGENTES.map(async (ag): Promise<Depoimento> => {
    const s = await coletarSemana(env, ag, desde);
    const licoes = s.memorias.filter((m) => m.tipo === 'aprendi').length;
    const cobrancas = s.memorias.filter((m) => m.tipo === 'cobranca').length;

    const entrada = [
      `Seus números desta semana: participou de ${s.reunioes} reunião(ões); ${s.falhas} chamada(s) sua(s) falharam; ` +
      `${licoes} lição(ões) que você mesmo registrou; ${cobrancas} cobrança(s) que a mesa deixou pra você.`,
      s.memorias.length
        ? 'Sua memória da semana:\n' + s.memorias.map((m) => `- (${m.tipo}) ${m.licao}`).join('\n')
        : 'Sua memória da semana está vazia — você não registrou lição nenhuma e ninguém te cobrou nada.',
      s.falas.length
        ? 'O que você falou nas reuniões:\n' + s.falas.slice(0, 14).map((f) => `- ${f}`).join('\n')
        : 'Você não falou em nenhuma reunião nesta semana.',
    ].join('\n\n');

    // O depoimento é de uma PESSOA contando a semana dela, não de um cargo
    // relatando métricas — por isso a ficha inteira entra aqui.
    const r = await chamarAgente(
      env,
      formatarPessoa(ag.chave) + `\n\nNo dia a dia você é ${ag.papel}. Sua fonte de dado é: ${ag.fonte}.\n\n` + SYSTEM_BASE,
      entrada,
      undefined,
      0.6,
    );

    const texto = r.ok ? String((r.dados as any)?.depoimento || '').trim() : '';
    return {
      chave: ag.chave, nome: PESSOAS[ag.chave]?.nome || ag.nome,
      depoimento: texto || `(não consegui escrever meu depoimento nesta semana: ${r.erro || 'resposta vazia do modelo'})`,
      reunioes: s.reunioes, falhas: s.falhas, licoes, cobrancas,
    };
  }));

  const agora = new Date().toISOString();
  for (const d of depoimentos) {
    try {
      await env.DB.exec('DELETE FROM boletins WHERE semana = ? AND chave = ?', [semana, d.chave]);
      await env.DB.exec(
        'INSERT INTO boletins (semana, chave, depoimento, reunioes, falhas, licoes, cobrancas, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [semana, d.chave, d.depoimento.slice(0, 2000), d.reunioes, d.falhas, d.licoes, d.cobrancas, agora],
      );
    } catch { /* um depoimento que não grava não derruba o boletim inteiro */ }
  }

  return { semana, depoimentos };
}

export async function lerBoletim(env: Env, semana: string) {
  const q = semana
    ? await env.DB.query('SELECT * FROM boletins WHERE semana = ? ORDER BY id', [semana])
    : await env.DB.query('SELECT * FROM boletins WHERE semana = (SELECT semana FROM boletins ORDER BY id DESC LIMIT 1) ORDER BY id', []);
  return q.rows;
}
