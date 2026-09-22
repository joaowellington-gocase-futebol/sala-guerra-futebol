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

  // ── O que faz a sala "aprender" ──────────────────────────────────────────
  //
  // MEMÓRIA: o agente termina cada reunião declarando o que aprendeu
  // (`aprendi`), e recebe essa memória de volta dentro do próprio system prompt
  // na reunião seguinte. Sem isso a mesa reinicia do zero a cada 2h — os
  // agentes repetiriam a mesma discussão pra sempre. Tipos:
  //   'aprendi'  — lição que o próprio agente tirou
  //   'cobranca' — tarefa que a mesa combinou pra ele (cobrada na próxima)
  //   'vendas'   — o que o Mensurador mediu de resultado da decisão anterior
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS memoria_agente (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT NOT NULL,
      tipo TEXT NOT NULL, licao TEXT NOT NULL, origem_sessao TEXT,
      criado_em TEXT
    )`, []);
  await env.DB.exec(`CREATE INDEX IF NOT EXISTS ix_memoria ON memoria_agente(chave, id)`, []);

  // ATA: o fechamento de uma reunião — o que virou consenso, onde ficou
  // divergência (divergência registrada é resultado bom: quer dizer que
  // discutiram de verdade) e a tarefa de cada um até a próxima.
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS atas (
      sessao TEXT PRIMARY KEY, tema TEXT, quando TEXT, automatica INTEGER DEFAULT 0,
      resumo TEXT, consenso TEXT, divergencias TEXT, acoes TEXT,
      placar_vendas TEXT, webhook_status TEXT
    )`, []);
  await env.DB.exec(`CREATE INDEX IF NOT EXISTS ix_atas_quando ON atas(quando)`, []);
  // `CREATE TABLE IF NOT EXISTS` não acrescenta coluna em tabela que já existe,
  // e este app já rodou em produção — então a coluna nova entra por ALTER, que
  // dá erro se já estiver lá. O catch vazio É o controle de versão aqui.
  try { await env.DB.exec('ALTER TABLE atas ADD COLUMN resumo_curto TEXT', []); } catch { /* já existe */ }
  // Impressão digital do dado bruto que entrou na reunião. É o que permite
  // saber que NADA mudou desde a rodada anterior — ver src/historico.ts.
  try { await env.DB.exec('ALTER TABLE atas ADD COLUMN impressao TEXT', []); } catch { /* já existe */ }
  try { await env.DB.exec('ALTER TABLE atas ADD COLUMN modo TEXT', []); } catch { /* já existe */ }
  // O que a mesa RECOMENDA ao João (JSON) e o que ela entregou do que ele
  // pediu (JSON). Sem estes dois a ata explicava o mercado e terminava sem
  // dizer o que fazer — que foi a queixa que originou src/direcao.ts.
  try { await env.DB.exec('ALTER TABLE atas ADD COLUMN recomendacoes TEXT', []); } catch { /* já existe */ }
  try { await env.DB.exec('ALTER TABLE atas ADD COLUMN entregas TEXT', []); } catch { /* já existe */ }
  try { await env.DB.exec('ALTER TABLE atas ADD COLUMN precisamos_de_voce TEXT', []); } catch { /* já existe */ }
  // O que o juiz barrou por genérico (src/juiz.ts). Registrado de propósito: se
  // a mesa reprova muito, o problema é a mesa; se reprova nada, o juiz ficou frouxo.
  try { await env.DB.exec('ALTER TABLE atas ADD COLUMN reprovadas TEXT', []); } catch { /* já existe */ }
  // 22/09/2026: a entrega deixou de ser recomendação tática e virou LEITURA de
  // mercado (src/mercado/leitura.ts). A coluna `recomendacoes` fica onde está,
  // com o histórico antigo — a página da ata ainda sabe exibi-la.
  try { await env.DB.exec('ALTER TABLE atas ADD COLUMN leituras TEXT', []); } catch { /* já existe */ }
  try { await env.DB.exec('ALTER TABLE atas ADD COLUMN movimento_teses TEXT', []); } catch { /* já existe */ }
  try { await env.DB.exec('ALTER TABLE atas ADD COLUMN avisos TEXT', []); } catch { /* já existe */ }

  // FALAS: a linha do tempo da reunião em texto curto, do jeito que a salinha
  // 16-bit precisa pra reencenar a conversa em balões sobre os sprites.
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS falas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sessao TEXT NOT NULL, ordem INTEGER,
      rodada TEXT, chave TEXT, texto TEXT, criado_em TEXT
    )`, []);
  await env.DB.exec(`CREATE INDEX IF NOT EXISTS ix_falas ON falas(sessao, ordem)`, []);

  // BOLETIM: uma vez por semana cada agente escreve um depoimento em primeira
  // pessoa sobre a própria semana. Não é relatório de sistema — é o agente
  // contando se deu conta do que foi cobrado dele e o que ainda trava.
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS boletins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, semana TEXT NOT NULL, chave TEXT NOT NULL,
      depoimento TEXT, reunioes INTEGER, falhas INTEGER, licoes INTEGER, cobrancas INTEGER,
      criado_em TEXT
    )`, []);
  await env.DB.exec(`CREATE INDEX IF NOT EXISTS ix_boletins ON boletins(semana, chave)`, []);

  // O que a mesa já viu e não deve reportar de novo (hoje: link de manchete).
  // Sem isto o Torcedor repetia a mesma notícia a cada 2 h, porque o RSS não
  // muda nesse intervalo.
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS vistos (
      tipo TEXT NOT NULL, chave TEXT NOT NULL, quando TEXT,
      PRIMARY KEY (tipo, chave)
    )`, []);

  // ── O que faz a sala ser gente e não função ──────────────────────────────
  //
  // ESTADO: cada um chega na reunião de um jeito. `humor` e `obsessao` são
  // declarados pelo próprio agente no fim de cada rodada e voltam pra ele na
  // seguinte. É o que dá continuidade — a pessoa que saiu irritada da última
  // reunião ainda está irritada duas horas depois, e o que não saía da cabeça
  // dela continua não saindo.
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS estado_agente (
      chave TEXT PRIMARY KEY, humor TEXT, obsessao TEXT,
      trouxe_por_conta_propria TEXT, o_que_me_trava TEXT, atualizado_em TEXT
    )`, []);

  // CONVERSAS DE CORREDOR: dois deles se cruzam entre as reuniões e conversam
  // sobre o que quiserem — inclusive coisa que não é da pauta. É barato (uma
  // chamada) e é de onde sai boa parte da informação que não cabia num
  // formulário. Quando a conversa rende algo, vira pauta da próxima reunião.
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS conversas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, quando TEXT, a TEXT, b TEXT,
      assunto TEXT, falas TEXT, rendeu TEXT, aproveitada INTEGER DEFAULT 0
    )`, []);
  await env.DB.exec(`CREATE INDEX IF NOT EXISTS ix_conversas ON conversas(quando)`, []);

  // ── A voz do coordenador ─────────────────────────────────────────────────
  //
  // O que faltava pro João mandar na equipe em vez de só assistir a ela:
  // tema (a pauta que ELE dá), feedback (correção de rumo que entra no prompt
  // de todo mundo) e demanda (pedido com dono e prazo, cobrado a cada rodada
  // até ele dar por entregue). Ver src/direcao.ts.
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS direcao (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT NOT NULL, texto TEXT NOT NULL,
      para TEXT, prazo TEXT, status TEXT DEFAULT 'aberta',
      criado_em TEXT, criado_por TEXT, atendida_em TEXT,
      resposta TEXT, rodadas INTEGER DEFAULT 0
    )`, []);
  await env.DB.exec(`CREATE INDEX IF NOT EXISTS ix_direcao ON direcao(status, id)`, []);

  // ── O que a mesa entende sobre o mercado ─────────────────────────────────
  //
  // O ponto que faltava: a mesa não existe pra decidir uma capinha, existe pra
  // ENTENDER COMO O MERCADO ANDA. Entendimento não cabe numa ata — ele se
  // acumula, é revisado e às vezes cai. Cada crença aqui nasceu de uma
  // pergunta testada contra a venda real, e carrega a evidência que a sustenta.
  // Investigação nova é obrigada a tentar derrubar as que estão de pé.
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS crencas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, afirmacao TEXT NOT NULL,
      evidencia TEXT, confianca REAL, status TEXT DEFAULT 'viva',
      nascida_em TEXT, revisada_em TEXT, vezes_confirmada INTEGER DEFAULT 1
    )`, []);
  await env.DB.exec(`CREATE INDEX IF NOT EXISTS ix_crencas ON crencas(status, id)`, []);

  // Cada pergunta que a mesa se fez, com o SQL que ela mesma escreveu e o que
  // o número respondeu. É o registro de que houve investigação e não palpite —
  // e guarda também as perguntas REFUTADAS, que é o que ninguém costuma anotar.
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS investigacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sessao TEXT, pergunta TEXT,
      hipotese TEXT, sql_usado TEXT, linhas INTEGER, veredito TEXT,
      o_que_o_numero_diz TEXT, criado_em TEXT
    )`, []);
  await env.DB.exec(`CREATE INDEX IF NOT EXISTS ix_investig ON investigacoes(sessao)`, []);

  // Configuração editável na tela (webhook, tema padrão, liga/desliga o
  // automático) — fica em banco e não em secret pra poder mudar sem deploy.
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS config (
      chave TEXT PRIMARY KEY, valor TEXT, atualizado_em TEXT
    )`, []);

  // Fotografia de vendas no momento da reunião: é o que permite ao Mensurador
  // dizer "desde a reunião passada, isto subiu/caiu" em vez de só descrever o
  // presente.
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS snapshot_vendas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sessao TEXT, resumo TEXT, criado_em TEXT
    )`, []);
}

export async function lerConfig(env: Env, chave: string): Promise<string> {
  const q = await env.DB.query('SELECT valor FROM config WHERE chave = ?', [chave]);
  return String(q.rows[0]?.valor || '');
}

export async function gravarConfig(env: Env, chave: string, valor: string) {
  await env.DB.exec(
    `INSERT INTO config (chave, valor, atualizado_em) VALUES (?, ?, ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
    [chave, valor, new Date().toISOString()],
  );
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
