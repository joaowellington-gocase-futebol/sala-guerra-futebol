// Schema e helpers de escrita. O env.DB (SQLite) do GoDeploy rejeita statements
// com mais de ~100 parâmetros ligados — não é o limite padrão do SQLite (999),
// é bem mais baixo e não documentado. Descoberto no Radar Futebol e reincidiu
// no SKUs de Futebol. Todo INSERT em lote aqui passa por `inserirEmLotes`.
// Ver memória [[godeploy-sqlite-100-params]].

import type { Env } from './aiproxy';

export async function migrar(env: Env) {
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS donos (
      chave TEXT PRIMARY KEY, dono TEXT, prompt TEXT
    )`, []);

  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS execucoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT NOT NULL, sessao TEXT,
      entrada TEXT, ok INTEGER, dados TEXT, erro TEXT, ms INTEGER, modelo TEXT,
      criado_em TEXT
    )`, []);
  await env.DB.exec(`CREATE INDEX IF NOT EXISTS ix_exec_chave ON execucoes(chave, criado_em)`, []);

  // A mesa: recado que um agente deixa para outro, entregue na próxima execução
  // do destinatário. Mesmo desenho da Fábrica de Térmicos (app/src/server.ts).
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS recados (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sessao TEXT NOT NULL,
      de TEXT NOT NULL, para TEXT NOT NULL, assunto TEXT, pedido TEXT,
      lido INTEGER DEFAULT 0, quando TEXT
    )`, []);
  await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_recados ON recados(sessao, para, lido)`, []);

  // Registro de reunião: uma "Convocar reunião" completa, com a cadeia de
  // agentes chamados em sequência e o texto trocado — pra reexibir na tela.
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS reunioes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sessao TEXT NOT NULL,
      etapa INTEGER, chave TEXT, dados TEXT, criado_em TEXT
    )`, []);
  await env.DB.exec(`CREATE INDEX IF NOT EXISTS ix_reuniao_sessao ON reunioes(sessao, etapa)`, []);

  // Livro-razão de valor gerado — ver seção "Contador de Valor" do plano.
  // Alimentado por fetch automático (hub-futebol) e por entrada manual/estimada
  // pros apps que não têm uma métrica de receita exposta.
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS ledger_entradas (
      slug TEXT PRIMARY KEY, nome TEXT, dono TEXT, fonte_de_valor TEXT,
      valor REAL, unidade TEXT, automatico INTEGER DEFAULT 0,
      observacao TEXT, atualizado_em TEXT
    )`, []);
}

/**
 * Insere linhas em lotes que respeitam o teto de ~100 parâmetros ligados por
 * statement. O tamanho do lote é calculado a partir do nº de colunas, nunca
 * escolhido a olho — e cai para linha a linha se mesmo assim falhar.
 */
export async function inserirEmLotes(
  env: Env,
  tabela: string,
  colunas: string[],
  linhas: unknown[][],
): Promise<number> {
  if (linhas.length === 0) return 0;
  const tamanhoLote = Math.max(1, Math.floor(100 / colunas.length) - 1);
  const placeholdersLinha = `(${colunas.map(() => '?').join(', ')})`;
  let gravadas = 0;

  for (let i = 0; i < linhas.length; i += tamanhoLote) {
    const bloco = linhas.slice(i, i + tamanhoLote);
    const sql = `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES ${bloco.map(() => placeholdersLinha).join(', ')}`;
    const params = bloco.flat();
    try {
      await env.DB.exec(sql, params);
      gravadas += bloco.length;
    } catch {
      // Fallback linha a linha — não deixa o lote inteiro cair por um erro isolado.
      for (const linha of bloco) {
        try {
          await env.DB.exec(`INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES ${placeholdersLinha}`, linha);
          gravadas += 1;
        } catch {
          // linha realmente inválida — segue para não travar as demais.
        }
      }
    }
  }
  return gravadas;
}
