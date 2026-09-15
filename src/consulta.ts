// A ferramenta que faz os agentes PENSAREM em vez de comentar.
//
// Até aqui eles recebiam um dado pré-mastigado: eu escrevia a query, eles
// opinavam sobre o resultado. Isso não é pensar, é legendar. Um analista de
// verdade tem uma dúvida e vai atrás — escreve a consulta, olha o que voltou,
// descobre que a pergunta estava errada e refaz.
//
// Aqui o agente escreve o SQL. O worker valida, executa e devolve as linhas
// pra ele ler. Se o SQL quebrar, o ERRO volta pra ele — e ele corrige, que é
// exatamente o que uma pessoa faria.
//
// Como isso é seguro, já que o texto vem de um modelo:
//   • só SELECT/WITH, um único statement, ponto e vírgula proibido;
//   • lista de tabelas permitidas, conferida contra todo FROM/JOIN;
//   • LIMIT obrigatório, teto de 200 linhas, imposto por nós e não por ele;
//   • nada de comentário SQL (-- e /* */), que é o caminho clássico de burlar
//     validação por regex;
//   • timeout curto.
// A chave do Metabase é do app e o escopo dela é leitura; ainda assim a trava
// é feita aqui, porque confiar no escopo lá fora é confiar demais.
//
// ── POR QUE A VALIDAÇÃO OLHA O "ESQUELETO" E NÃO O SQL CRU (15/09/2026) ──
//
// A mesa passou dias reportando "esta rodada não ensinou nada: as perguntas
// ficaram sem resposta porque faltou acesso aos dados". Não faltava acesso
// nenhum — a chave do Metabase estava lá o tempo todo. O que acontecia é que
// a checagem de palavra proibida rodava sobre o SQL INTEIRO, literais de texto
// incluídos, e a lista tinha `do` (o comando DO do Postgres). Em português,
// "do" aparece dentro de quase todo filtro de nome de produto — 'Uniforme do
// Ceará', 'Camisa do Vozão'. Resultado: a consulta era recusada ANTES de sair
// do worker, as duas tentativas do agente morriam igual, e a reunião inteira
// terminava sem número nenhum.
//
// Agora a validação roda sobre o esqueleto: o mesmo SQL com todo literal de
// texto e todo identificador entre aspas trocado por vazio. Comando de verdade
// nunca está dentro de aspas; nome de clube, sim, quase sempre.

import type { Env } from './aiproxy';

const METABASE_URL = 'https://metabase.gocase.com.br/api/dataset';
const DATABASE_ID_SILVER = 63;
const TETO_LINHAS = 200;

/** O que o agente pode olhar. Mexer aqui é ampliar o mundo dele — faça com cuidado. */
export const TABELAS_PERMITIDAS = ['silver.line_items', 'silver.orders'];

/**
 * Funções de tabela que podem aparecer depois de FROM/JOIN sem serem tabela.
 * `unnest` está aqui porque o próprio dicionário manda usar em taxon_array_nomes
 * — e sem esta lista a consulta certa era recusada como "tabela não liberada".
 */
const FUNCOES_DE_TABELA = ['unnest', 'generate_series', 'jsonb_array_elements', 'jsonb_array_elements_text', 'lateral'];

// Só o que muda dado ou sai do banco. Comando de sessão (SET, BEGIN, DO...) não
// entra porque é inalcançável: ponto e vírgula é proibido e a consulta é
// obrigada a começar em SELECT/WITH.
const PROIBIDO = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|merge|pg_sleep|dblink|lo_import|lo_export|pg_read_file|pg_ls_dir)\b/i;

export interface Consulta {
  ok: boolean;
  erro?: string;
  colunas: string[];
  linhas: unknown[][];
  linhasRetornadas: number;
  sqlExecutado?: string;
}

const falha = (erro: string): Consulta => ({ ok: false, erro, colunas: [], linhas: [], linhasRetornadas: 0 });

/**
 * O SQL sem o conteúdo de literais ('...') nem de identificadores citados
 * ("..."). É sobre isto que a validação decide — ver o cabeçalho do arquivo.
 * As aspas continuam no lugar pra não colar dois tokens que eram separados.
 */
export function esqueleto(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

/** Valida e normaliza. Devolve o SQL pronto pra rodar, ou o motivo da recusa. */
export function validarSql(sqlBruto: string): { ok: true; sql: string } | { ok: false; erro: string } {
  const sql = String(sqlBruto || '').trim().replace(/;+\s*$/, '');

  if (!sql) return { ok: false, erro: 'consulta vazia' };
  if (sql.length > 4000) return { ok: false, erro: 'consulta longa demais (máximo 4000 caracteres)' };

  const osso = esqueleto(sql);

  if (osso.includes(';')) return { ok: false, erro: 'só é permitido um comando por consulta — tire o ponto e vírgula do meio' };
  if (/--|\/\*|\*\//.test(osso)) return { ok: false, erro: 'comentário SQL não é permitido aqui' };
  if (!/^\s*(select|with)\b/i.test(osso)) return { ok: false, erro: 'só SELECT (ou WITH ... SELECT) é permitido' };
  const proibida = osso.match(PROIBIDO);
  if (proibida) return { ok: false, erro: `a consulta usa "${proibida[1]}", que não é comando de leitura` };

  // Toda tabela citada em FROM/JOIN tem que estar na lista. Aliases de CTE são
  // aceitos porque são definidos dentro da própria consulta, e função de tabela
  // (unnest e afins) também — não é tabela, é chamada.
  const ctes = new Set(
    [...osso.matchAll(/\b(?:with|,)\s+([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()),
  );
  const referencias = [...osso.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_.]*)/gi)]
    .map((m) => m[1].toLowerCase());
  for (const ref of referencias) {
    if (ctes.has(ref)) continue;
    if (FUNCOES_DE_TABELA.includes(ref)) continue;
    if (!TABELAS_PERMITIDAS.includes(ref)) {
      return { ok: false, erro: `tabela "${ref}" não está liberada. Só dá pra consultar: ${TABELAS_PERMITIDAS.join(', ')}` };
    }
  }

  // LIMIT é nosso, não dele: se já veio um, respeitamos até o teto; se não
  // veio, colamos. Assim uma consulta distraída não varre a tabela inteira.
  const comLimit = sql.match(/\blimit\s+(\d+)\s*$/i);
  if (comLimit) {
    const pedido = Number(comLimit[1]);
    return { ok: true, sql: pedido > TETO_LINHAS ? sql.replace(/\blimit\s+\d+\s*$/i, `LIMIT ${TETO_LINHAS}`) : sql };
  }
  return { ok: true, sql: `${sql}\nLIMIT ${TETO_LINHAS}` };
}

export async function executarConsulta(env: Env, sqlBruto: string): Promise<Consulta> {
  if (!env.METABASE_API_KEY) return falha('Falta o METABASE_API_KEY deste app.');

  const v = validarSql(sqlBruto);
  if (!v.ok) return falha(v.erro);

  try {
    const res = await fetch(METABASE_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.METABASE_API_KEY, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(40000),
      body: JSON.stringify({ type: 'native', native: { query: v.sql }, database: DATABASE_ID_SILVER }),
    });
    const texto = await res.text();
    if (!res.ok) return { ...falha(`o banco recusou: ${texto.slice(0, 400)}`), sqlExecutado: v.sql };

    const corpo = JSON.parse(texto) as {
      data?: { rows?: unknown[][]; cols?: { name?: string; display_name?: string }[] };
      error?: string;
    };
    if (corpo.error) return { ...falha(`erro de SQL: ${String(corpo.error).slice(0, 400)}`), sqlExecutado: v.sql };

    const linhas = corpo.data?.rows || [];
    const colunas = (corpo.data?.cols || []).map((c) => String(c.display_name || c.name || '?'));
    return { ok: true, colunas, linhas, linhasRetornadas: linhas.length, sqlExecutado: v.sql };
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    return { ...falha(/timeout|aborted/i.test(msg) ? 'a consulta passou de 40s e foi cortada — simplifique' : 'falha ao consultar: ' + msg), sqlExecutado: v.sql };
  }
}

/** As linhas em texto, do jeito que cabe num prompt sem estourar contexto. */
export function formatarResultado(c: Consulta, maxLinhas = 40): string {
  if (!c.ok) return `A CONSULTA FALHOU: ${c.erro}`;
  if (!c.linhas.length) return 'A consulta rodou e voltou ZERO linhas. Isso é um resultado — normalmente quer dizer que o filtro estava errado, ou que a coisa que você procurava não existe.';
  const corpo = c.linhas.slice(0, maxLinhas)
    .map((l) => l.map((v) => (v === null ? '—' : String(v))).join(' | '))
    .join('\n');
  return `${c.colunas.join(' | ')}\n${corpo}` +
    (c.linhas.length > maxLinhas ? `\n(… ${c.linhas.length - maxLinhas} linhas a mais, não mostradas)` : '');
}

/** O manual da tabela, pro agente escrever SQL que funciona na primeira. */
export const DICIONARIO = `
TABELA: silver.line_items — um item vendido por linha. É a venda real, com dado do próprio dia.
  item_created_at   timestamp  quando o item foi vendido (use para janela de tempo)
  product_name      text       nome do produto, ex.: " Palmeiras  - Uniforme 3 Selo"
  item_quantity     int        unidades
  item_price        float      preço cheio
  item_discount_price float    preço pago (use COALESCE(item_discount_price, item_price) para receita)
  custo_cmv         float      custo da mercadoria (dá para calcular margem)
  categoria         text       categoria do produto
  familia           text       família do produto
  tipo              text       tipo
  cor               text       cor
  case_type         text       tipo de capinha, quando for capinha
  device            text       aparelho, quando for capinha
  product_sku       text       SKU
  product_macro_category text  categoria macro
  order_number      text       pedido
  taxon_array_nomes text[]     categorias do produto no site (use unnest para abrir)

TABELA: silver.orders — um pedido por linha.
  order_number, total_price, created_at, locked, aasm_state

COMO IDENTIFICAR FUTEBOL: não existe flag. Use o nome do produto:
  product_name ~* 'flamengo|corinthians|palmeiras|vasco|botafogo|fluminense|s[ãa]o paulo|internacional|gr[êe]mio|vit[óo]ria|sport recife|santos|fortaleza|coritiba|cruzeiro|cear[áa]|bahia|atl[ée]tico'

REGRAS DA CASA:
  • Postgres. Um único SELECT (CTE permitido). Sem ponto e vírgula, sem comentário.
  • Só silver.line_items e silver.orders. Função de tabela (unnest e afins) pode.
  • Sempre filtre item_created_at, senão a consulta varre anos.
  • Prefira agregado a linha crua: você tem no máximo 200 linhas de resposta.
  • Compare sempre contra uma base (semana anterior, outro grupo). Número solto não prova nada.
  • Você tem 40 segundos. Consulta com muito LIKE em cima de 14 dias passa; varredura de ano inteiro não.
`;
