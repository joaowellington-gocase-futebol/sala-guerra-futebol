// Sala de Guerra do Futebol — hub de agentes de IA da Gocase para futebol.
//
// Mesmo padrão da Fábrica de Térmicos (app/src/server.ts): agente roda contra
// o AI Proxy, instrução editável salva em env.DB, e a mesa troca "recados"
// entre chamadas. A diferença aqui é que vários agentes têm FONTE AUTOMÁTICA
// de dado real (radar-futebol, hub-futebol, acervo-futebol, Metabase, RSS) —
// quando ninguém manda uma entrada manual, o worker busca o dado ao vivo
// antes de chamar o AI Proxy, em vez de depender do usuário colar JSON.

import { AGENTES, acharAgente, type Agente } from './src/agentes';
import { chamarAgente, chamarAgenteTexto, type Env as AiEnv } from './src/aiproxy';
import { migrar, inserirEmLotes } from './src/db';
import { entregarRecados, registrarRecados, formatarRecadosParaPrompt, quadroDaSessao } from './src/mesa';
import { buscarPainelTendencias } from './src/fontes/radarFutebol';
import { buscarResumoLancamentos } from './src/fontes/hubLancamentos';
import { buscarReferenciasAcervo } from './src/fontes/acervoFutebol';
import { buscarPedidosFutebolTravados } from './src/fontes/pedidosTravados';
import { buscarManchetesReais } from './src/fontes/noticiasFutebol';

interface Env extends AiEnv {}

function json(d: unknown, s = 200): Response {
  return new Response(JSON.stringify(d), {
    status: s,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Busca o dado real de um agente quando ele tem fonte automática. `null` = sem fonte automática, use entrada manual. */
async function buscarFonteAutomatica(env: Env, chave: string): Promise<{ dados: unknown; fontesComFalha: string[] } | null> {
  switch (chave) {
    case 'tendencias': {
      const r = await buscarPainelTendencias(env);
      return { dados: { painel: r.painel }, fontesComFalha: r.fontes_com_falha };
    }
    case 'torcedor': {
      const r = await buscarManchetesReais(env);
      return { dados: { manchetes: r.manchetes }, fontesComFalha: r.ok ? [] : [r.erro || 'falha desconhecida'] };
    }
    case 'avaliador': {
      const r = await buscarResumoLancamentos(env);
      return { dados: { launches: r.launches, summary: r.summary }, fontesComFalha: r.fontes_com_falha };
    }
    case 'fiscal': {
      const r = await buscarPedidosFutebolTravados(env);
      return { dados: { pedidos: r.pedidos }, fontesComFalha: r.ok ? [] : [r.erro || 'falha desconhecida'] };
    }
    case 'concorrencia':
    case 'diretorarte': {
      const r = await buscarReferenciasAcervo(env);
      return { dados: { itens_acervo: r.itens }, fontesComFalha: r.fontes_com_falha };
    }
    case 'contador': {
      const q = await env.DB.query('SELECT * FROM ledger_entradas ORDER BY slug', []);
      return { dados: { entradas: q.rows }, fontesComFalha: [] };
    }
    default:
      return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const p = url.pathname;
    const quem = request.headers.get('x-godeploy-user-email') || 'anônimo';

    if (p === '/') return Response.redirect(url.origin + '/index.html', 302);
    if (!p.startsWith('/api/')) return new Response('Not found', { status: 404 });

    try {
      await migrar(env);

      if (p === '/api/estado') {
        const [donos, execs] = await Promise.all([
          env.DB.query('SELECT * FROM donos', []),
          env.DB.query('SELECT id, chave, sessao, ok, ms, modelo, criado_em FROM execucoes ORDER BY id DESC LIMIT 20', []),
        ]);
        const mapa = new Map(donos.rows.map((d) => [String(d.chave), d]));
        return json({
          usuario: quem,
          temToken: !!env.AI_PROXY_TOKEN,
          modelo: env.AI_MODEL || 'gpt-5.5',
          agentes: AGENTES.map((a) => {
            const d = mapa.get(a.chave);
            return {
              chave: a.chave, nome: a.nome, oque: a.oque, area: a.area, fora: a.fora, fonte: a.fonte,
              modoTexto: !!a.modoTexto, exemplo: a.exemplo, dono: d ? String(d.dono) : '',
              system: d && String(d.prompt) ? String(d.prompt) : a.system,
              customizado: !!(d && String(d.prompt)),
            };
          }),
          execucoes: execs.rows,
        });
      }

      if (p === '/api/rodar' && request.method === 'POST') {
        const b = (await request.json()) as { agente?: string; entrada?: string; system?: string; sessao?: string; usarExemplo?: boolean };
        const ag = acharAgente(String(b.agente || '')) as Agente | undefined;
        if (!ag) return json({ error: 'Esse agente não existe.' }, 400);

        const sessao = String(b.sessao || '').slice(0, 80) || 'avulso';
        let system = String(b.system || '').trim();
        if (!system) {
          const salvo = await env.DB.query('SELECT prompt FROM donos WHERE chave = ?', [ag.chave]);
          system = String(salvo.rows[0]?.prompt || '') || ag.system;
        }

        // Entrada: manual > exemplo forçado > fonte automática ao vivo > exemplo como último recurso.
        let entrada = String(b.entrada || '').trim();
        let fontesComFalha: string[] = [];
        if (!entrada && !b.usarExemplo && !ag.modoTexto) {
          const fonte = await buscarFonteAutomatica(env, ag.chave);
          if (fonte) {
            entrada = JSON.stringify(fonte.dados, null, 2);
            fontesComFalha = fonte.fontesComFalha;
          }
        }
        if (!entrada) entrada = ag.exemplo;

        const pendentes = await entregarRecados(env, sessao, ag.chave);
        const recadosTxt = formatarRecadosParaPrompt(pendentes);

        let resultado;
        if (ag.modoTexto) {
          resultado = await chamarAgenteTexto(env, system, [{ role: 'user', content: entrada }], ag.temperatura);
        } else {
          let corpo = ag.user(entrada) + recadosTxt;
          if (fontesComFalha.length) corpo += `\n\n(Fontes com falha nesta chamada: ${fontesComFalha.join('; ')})`;
          resultado = await chamarAgente(env, system, corpo, ag.visao ? entrada : undefined, ag.temperatura);
        }

        if (resultado.ok && !ag.modoTexto) {
          const saiu = ((resultado.dados as any)?.recados_para || []) as { para?: string; assunto?: string; pedido?: string }[];
          await registrarRecados(env, sessao, ag.chave, saiu.slice(0, 6));
        }

        await env.DB.exec(
          `INSERT INTO execucoes (chave, sessao, entrada, ok, dados, erro, ms, modelo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [ag.chave, sessao, entrada.slice(0, 2000), resultado.ok ? 1 : 0,
           JSON.stringify(resultado.ok ? resultado.dados : null).slice(0, 4000),
           resultado.ok ? null : String(resultado.erro || ''), resultado.ms, resultado.modelo, new Date().toISOString()],
        );

        return json(resultado, resultado.ok ? 200 : 502);
      }

      if (p === '/api/recados') {
        const sessao = (url.searchParams.get('sessao') || 'avulso').slice(0, 80);
        return json({ recados: await quadroDaSessao(env, sessao) });
      }

      if (p === '/api/dono' && request.method === 'POST') {
        const b = (await request.json()) as { agente?: string; dono?: string };
        const ag = acharAgente(String(b.agente || ''));
        if (!ag) return json({ error: 'Esse agente não existe.' }, 400);
        await env.DB.exec(
          `INSERT INTO donos (chave, dono) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET dono = excluded.dono`,
          [ag.chave, String(b.dono || '').trim().slice(0, 60)],
        );
        return json({ ok: true });
      }

      if (p === '/api/prompt' && request.method === 'POST') {
        const b = (await request.json()) as { agente?: string; system?: string };
        const ag = acharAgente(String(b.agente || ''));
        if (!ag) return json({ error: 'Esse agente não existe.' }, 400);
        await env.DB.exec(
          `INSERT INTO donos (chave, prompt) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET prompt = excluded.prompt`,
          [ag.chave, String(b.system || '').trim()],
        );
        return json({ ok: true });
      }

      // "Convocar reunião": roda uma cadeia de agentes em sequência, cada um
      // recebendo a saída do anterior como contexto — a vitrine mais direta
      // do "time conversando entre si" via AI Proxy.
      if (p === '/api/reuniao' && request.method === 'POST') {
        const b = (await request.json()) as { sessao?: string; tema?: string; cadeia?: string[] };
        const sessao = String(b.sessao || '').slice(0, 80) || 'reuniao-' + Date.now();
        const tema = String(b.tema || '').trim();
        if (!tema) return json({ error: 'Descreva o tema da reunião (ex.: um lançamento ou tendência).' }, 400);
        const cadeia = (b.cadeia?.length ? b.cadeia : ['tendencias', 'diretorarte', 'avaliador', 'redator'])
          .map((c) => acharAgente(c)).filter((a): a is Agente => !!a);

        const etapas: { chave: string; nome: string; dados: unknown; ok: boolean }[] = [];
        let contexto = `Tema da reunião: ${tema}`;
        let etapaN = 0;
        for (const ag of cadeia) {
          etapaN += 1;
          const fonte = ag.modoTexto ? null : await buscarFonteAutomatica(env, ag.chave);
          const entradaBase = fonte ? JSON.stringify(fonte.dados, null, 2) : ag.exemplo;
          const pendentes = await entregarRecados(env, sessao, ag.chave);
          const corpo = ag.user(entradaBase) + formatarRecadosParaPrompt(pendentes) +
            `\n\nCONTEXTO DA REUNIÃO ATÉ AGORA:\n${contexto}`;

          const r = await chamarAgente(env, ag.system, corpo, undefined, ag.temperatura);
          const saiu = r.ok ? ((r.dados as any)?.recados_para || []) : [];
          await registrarRecados(env, sessao, ag.chave, saiu.slice(0, 6));

          await env.DB.exec(
            'INSERT INTO reunioes (sessao, etapa, chave, dados, criado_em) VALUES (?, ?, ?, ?, ?)',
            [sessao, etapaN, ag.chave, JSON.stringify(r.ok ? r.dados : { erro: r.erro }), new Date().toISOString()],
          );
          etapas.push({ chave: ag.chave, nome: ag.nome, dados: r.ok ? r.dados : { erro: r.erro }, ok: r.ok });
          contexto += `\n\n[${ag.nome}]: ${JSON.stringify(r.ok ? r.dados : { erro: r.erro })}`;
        }

        return json({ sessao, tema, etapas });
      }

      if (p === '/api/reuniao/historico') {
        const sessao = (url.searchParams.get('sessao') || '').slice(0, 80);
        if (!sessao) return json({ error: 'Informe a sessão.' }, 400);
        const q = await env.DB.query('SELECT etapa, chave, dados, criado_em FROM reunioes WHERE sessao = ? ORDER BY etapa', [sessao]);
        return json({ etapas: q.rows });
      }

      if (p === '/api/ledger' && request.method === 'GET') {
        const q = await env.DB.query('SELECT * FROM ledger_entradas ORDER BY slug', []);
        return json({ entradas: q.rows });
      }

      if (p === '/api/ledger' && request.method === 'POST') {
        const b = (await request.json()) as { entradas?: Record<string, unknown>[] };
        const linhas = (b.entradas || []).slice(0, 200);
        if (!linhas.length) return json({ error: 'Mande ao menos uma entrada.' }, 400);
        const colunas = ['slug', 'nome', 'dono', 'fonte_de_valor', 'valor', 'unidade', 'automatico', 'observacao', 'atualizado_em'];
        const agora = new Date().toISOString();
        const linhasSql = linhas.map((e) => [
          String(e.slug || ''), String(e.nome || ''), String(e.dono || ''), String(e.fonte_de_valor || ''),
          e.valor === null || e.valor === undefined ? null : Number(e.valor), e.unidade ? String(e.unidade) : null,
          e.automatico ? 1 : 0, e.observacao ? String(e.observacao) : null, agora,
        ]);
        // upsert manual: apaga as chaves que vamos regravar, depois insere em lote (guarda de 100 params).
        for (const l of linhasSql) await env.DB.exec('DELETE FROM ledger_entradas WHERE slug = ?', [l[0]]);
        const gravadas = await inserirEmLotes(env, 'ledger_entradas', colunas, linhasSql);
        return json({ ok: true, gravadas });
      }

      if (p === '/api/pedidos-travados') {
        return json(await buscarPedidosFutebolTravados(env));
      }

      return json({ error: 'Rota não encontrada.' }, 404);
    } catch (e) {
      return json({ error: (e as Error)?.message || String(e) }, 500);
    }
  },
};
