// Sala de Guerra do Futebol — ecossistema de agentes de IA da Gocase para futebol.
//
// Mesmo padrão da Fábrica de Térmicos (app/src/server.ts): agente roda contra
// o AI Proxy, instrução editável salva em env.DB, e a mesa troca "recados"
// entre chamadas. A diferença aqui é que vários agentes têm FONTE AUTOMÁTICA
// de dado real (radar-futebol, hub-futebol, acervo-futebol, Metabase, RSS) —
// quando ninguém manda uma entrada manual, o worker busca o dado ao vivo
// antes de chamar o AI Proxy, em vez de depender do usuário colar JSON.
//
// E, desde 15/09/2026, a mesa tem um COORDENADOR: o João dá pauta, feedback e
// demanda pelas rotas /api/direcao, e a reunião é obrigada a responder. Ver
// src/direcao.ts.
//
// Três coisas acontecem sozinhas, todas por cron da plataforma do GoDeploy
// (o app não se agenda: não tem setInterval nem scheduled()):
//   POST /tasks/reuniao  de 2 em 2 horas — a mesa se reúne, aprende e lavra ata
//   POST /tasks/boletim  toda segunda    — cada agente escreve seu depoimento
//   POST /tasks/vozao    todo dia às 9h  — o Torcedor manda o recado do Ceará

import { AGENTES, acharAgente, type Agente } from './src/agentes';
import { chamarAgente, chamarAgenteTexto, type Env as AiEnv } from './src/aiproxy';
import { migrar, inserirEmLotes, lerConfig, gravarConfig } from './src/db';
import { entregarRecados, registrarRecados, formatarRecadosParaPrompt, quadroDaSessao } from './src/mesa';
import { memoriaDaSala, lembrar, gravarMemoria } from './src/memoria';
import { rodarReuniao, buscarFonteAutomatica, type ResultadoReuniao } from './src/reuniao';
import { dispararWebhook, resolverUrlWebhook, mandarAvisoCurto, type AtaParaWebhook } from './src/webhook';
import { renderizarPaginaAta } from './src/paginaAta';
import { renderizarPaginaBoletim } from './src/paginaBoletim';
import { gerarBoletim } from './src/boletim';
import { mandarOVozao } from './src/vozao';
import { conversaDeCorredor, conversasRecentes } from './src/corredor';
import { PESSOAS } from './src/pessoas';
import { buscarPedidosFutebolTravados } from './src/fontes/pedidosTravados';
import {
  abrirDirecao, listarDirecao, direcaoAberta, mudarStatus, donoProvavel, type TipoDirecao,
} from './src/direcao';

interface Env extends AiEnv {}

function json(d: unknown, s = 200): Response {
  return new Response(JSON.stringify(d), {
    status: s,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// A reunião é UMA por dia, às 11:00 UTC — 08:00 em Fortaleza, de modo que a
// ata já esteja pronta quando o João senta. Era de 2 em 2 horas até 16/09/2026
// e isso era parte do problema: 12 rodadas por dia sobre fontes que mudam uma
// vez ao dia só podiam produzir reunião rasa e repetida.
const HORA_DA_REUNIAO_UTC = 11;

function proximaReuniaoISO(): string {
  const agora = new Date();
  const prox = new Date(Date.UTC(
    agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), HORA_DA_REUNIAO_UTC, 0, 0, 0));
  if (prox.getTime() <= agora.getTime()) prox.setUTCDate(prox.getUTCDate() + 1);
  return prox.toISOString();
}

function paraWebhook(r: ResultadoReuniao, origem: string): AtaParaWebhook {
  return {
    sessao: r.sessao, tema: r.tema, quando: r.quando, automatica: r.automatica,
    resumo: r.ata.resumo, resumo_curto: r.ata.resumo_curto,
    consenso: r.ata.consenso, divergencias: r.ata.divergencias,
    acoes: r.ata.acoes, placar_vendas: r.ata.placar_vendas,
    recomendacoes: r.ata.recomendacoes,
    reprovadas: r.ata.reprovadas.length,
    entregas: r.ata.entregas.map((e) => ({ nome: e.nome, entrega: e.entrega, pronta: e.pronta })),
    precisamos_de_voce: r.ata.precisamos_de_voce,
    url: `${origem}/index.html?sessao=${encodeURIComponent(r.sessao)}`,
    urlAta: `${origem}/ata?sessao=${encodeURIComponent(r.sessao)}`,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const p = url.pathname;
    const quem = request.headers.get('x-godeploy-user-email') || 'anônimo';

    if (p === '/') return Response.redirect(url.origin + '/index.html', 302);
    if (!p.startsWith('/api/') && !p.startsWith('/tasks/') && p !== '/ata' && p !== '/boletim') {
      return new Response('Not found', { status: 404 });
    }

    try {
      await migrar(env);

      // A ata completa em página própria: é o link que sai no Google Chat, e
      // por isso é HTML servido direto, sem depender do canvas da salinha.
      if (p === '/ata') {
        return await renderizarPaginaAta(env, url.origin, (url.searchParams.get('sessao') || '').slice(0, 80));
      }

      if (p === '/boletim') {
        return await renderizarPaginaBoletim(env, url.origin, (url.searchParams.get('semana') || '').slice(0, 20));
      }

      // ── Reunião automática: rota chamada pelo cron da plataforma ─────────
      if (p === '/tasks/reuniao' && request.method === 'POST') {
        const assinadaPeloCron = !!request.headers.get('x-godeploy-cron');
        const manual = url.searchParams.get('manual') === '1';
        if (!assinadaPeloCron && !manual) {
          return json({ error: 'Esta rota é do cron da plataforma. Para disparar à mão use ?manual=1.' }, 401);
        }
        if ((await lerConfig(env, 'auto_ativo')) === 'nao' && !manual) {
          return json({ ok: true, pulou: 'reunião automática desligada no painel' });
        }

        const temaFixo = await lerConfig(env, 'tema_fixo');
        const r = await rodarReuniao(env, { tema: temaFixo || undefined, automatica: !manual });

        // Rodada de revisão não vai pro Chat. As fontes mudam ~1x/dia e a mesa
        // roda de 2 em 2 h: mandar card a cada rodada fazia o canal encher de
        // reunião que não aconteceu, e foi o que levou o João a dizer que as
        // reuniões estavam "bobas". Card só quando houve dado novo de verdade.
        let entrega: { ok: boolean; detalhe: string } | null = null;
        if (r.modo === 'completa') {
          entrega = await dispararWebhook(env, paraWebhook(r, url.origin));
          await env.DB.exec('UPDATE atas SET webhook_status = ? WHERE sessao = ?',
            [(entrega.ok ? 'ok: ' : 'falhou: ') + entrega.detalhe, r.sessao]);
        }

        return json({
          ok: true, sessao: r.sessao, tema: r.tema, modo: r.modo,
          etapas: r.etapas.length, recomendacoes: r.ata.recomendacoes.length, webhook: entrega,
          ...(r.modo === 'revisao' ? { nota: 'nenhuma fonte mudou e o João não mandou nada novo — rodou só a cobrança de pendências, sem webhook' } : {}),
        });
      }

      // ── Boletim semanal: cada agente escreve o próprio depoimento ───────
      if (p === '/tasks/boletim' && request.method === 'POST') {
        const assinadaPeloCron = !!request.headers.get('x-godeploy-cron');
        const manual = url.searchParams.get('manual') === '1';
        if (!assinadaPeloCron && !manual) return json({ error: 'Rota do cron. À mão, use ?manual=1.' }, 401);
        if ((await lerConfig(env, 'boletim_ativo')) === 'nao' && !manual) {
          return json({ ok: true, pulou: 'boletim semanal desligado no painel' });
        }

        const b = await gerarBoletim(env);
        const calados = b.depoimentos.filter((d) => d.reunioes === 0).map((d) => d.nome);
        const comFalha = b.depoimentos.filter((d) => d.falhas > 0).length;
        const entrega = await mandarAvisoCurto(env, [
          `*📊 Boletim da semana ${b.semana} — como os agentes estão se desenvolvendo*`,
          '',
          `${b.depoimentos.length} depoimentos, escritos por eles mesmos em primeira pessoa.` +
          (comFalha ? ` ${comFalha} agente(s) reclamaram de fonte que falhou.` : ''),
          calados.length ? `_Ficaram de fora da conversa nesta semana: ${calados.join(', ')}._` : '',
          '',
          `<${url.origin}/boletim?semana=${encodeURIComponent(b.semana)}|📄 Ler os depoimentos>`,
        ].filter(Boolean));

        return json({ ok: true, semana: b.semana, depoimentos: b.depoimentos.length, webhook: entrega });
      }

      // ── Conversa de corredor: a sala viva entre as reuniões ──────────────
      //
      // Uma chamada de IA. Dois deles se cruzam e conversam sem pauta. Não
      // manda nada pro Chat — isso é vida interna da agência, não relatório.
      if (p === '/tasks/corredor' && request.method === 'POST') {
        const assinadaPeloCron = !!request.headers.get('x-godeploy-cron');
        const manual = url.searchParams.get('manual') === '1';
        if (!assinadaPeloCron && !manual) return json({ error: 'Rota do cron. À mão, use ?manual=1.' }, 401);
        if ((await lerConfig(env, 'corredor_ativo')) === 'nao' && !manual) {
          return json({ ok: true, pulou: 'conversas de corredor desligadas no painel' });
        }
        const r = await conversaDeCorredor(env);
        return json(r, r.ok ? 200 : 502);
      }

      if (p === '/api/corredor') {
        return json({ conversas: await conversasRecentes(env, 12) });
      }

      // Quem é quem: a ficha das pessoas, pra tela mostrar gente e não cargo.
      if (p === '/api/pessoas') {
        return json({ pessoas: Object.values(PESSOAS) });
      }

      // ── A mesa do coordenador: tema, feedback e demanda ──────────────────
      //
      // É por aqui que o João manda na equipe. Nada disso espera a próxima
      // reunião pra valer: a direção entra na impressão digital da rodada, e
      // pedido novo dele faz a mesa reunir de verdade mesmo que o mundo lá
      // fora não tenha mexido.
      if (p === '/api/direcao' && request.method === 'GET') {
        const [todas, abertas] = await Promise.all([listarDirecao(env), direcaoAberta(env)]);
        return json({
          direcao: todas,
          abertas: { tema: abertas.tema, feedbacks: abertas.feedbacks.length, demandas: abertas.demandas.length },
          agentes: AGENTES.map((a) => ({ chave: a.chave, nome: PESSOAS[a.chave]?.nome || a.nome, oque: a.oque })),
        });
      }

      if (p === '/api/direcao' && request.method === 'POST') {
        const b = (await request.json()) as { tipo?: string; texto?: string; para?: string; prazo?: string };
        const tipo = String(b.tipo || '');
        if (!['tema', 'feedback', 'demanda'].includes(tipo)) {
          return json({ error: 'tipo tem que ser tema, feedback ou demanda.' }, 400);
        }
        const texto = String(b.texto || '').trim();
        if (texto.length < 3) return json({ error: 'Escreva o que você quer dizer pra eles.' }, 400);
        const para = String(b.para || '').trim();
        if (para && !acharAgente(para)) return json({ error: 'Esse agente não existe.' }, 400);

        const id = await abrirDirecao(env, {
          tipo: tipo as TipoDirecao, texto, para, prazo: String(b.prazo || '').trim(), quem,
        });
        return json({
          ok: true, id,
          // Quem vai responder, pra tela poder dizer isso na hora em vez de o
          // João descobrir só na ata.
          dono: tipo === 'demanda' ? (para || donoProvavel(texto)) : '',
          proximaReuniao: proximaReuniaoISO(),
        });
      }

      if (p === '/api/direcao/status' && request.method === 'POST') {
        const b = (await request.json()) as { id?: number; status?: string };
        const id = Number(b.id || 0);
        const status = String(b.status || '');
        if (!id) return json({ error: 'Informe o id.' }, 400);
        if (!['aberta', 'entregue', 'arquivada'].includes(status)) {
          return json({ error: 'status tem que ser aberta, entregue ou arquivada.' }, 400);
        }
        await mudarStatus(env, id, status);
        return json({ ok: true });
      }

      // ── O Vozão de todo dia: o recado do Torcedor ────────────────────────
      if (p === '/tasks/vozao' && request.method === 'POST') {
        const assinadaPeloCron = !!request.headers.get('x-godeploy-cron');
        const manual = url.searchParams.get('manual') === '1';
        if (!assinadaPeloCron && !manual) return json({ error: 'Rota do cron. À mão, use ?manual=1.' }, 401);
        if ((await lerConfig(env, 'vozao_ativo')) !== 'sim' && !manual) {
          return json({ ok: true, pulou: 'recado diário do Torcedor desligado no painel' });
        }
        const r = await mandarOVozao(env);
        return json(r, r.ok ? 200 : 502);
      }

      if (p === '/api/estado') {
        const [donos, execs, urlWebhook, autoAtivo, temaFixo, abertas] = await Promise.all([
          env.DB.query('SELECT * FROM donos', []),
          env.DB.query('SELECT id, chave, sessao, ok, ms, modelo, criado_em FROM execucoes ORDER BY id DESC LIMIT 20', []),
          resolverUrlWebhook(env),
          lerConfig(env, 'auto_ativo'),
          lerConfig(env, 'tema_fixo'),
          direcaoAberta(env),
        ]);
        const mapa = new Map(donos.rows.map((d) => [String(d.chave), d]));
        return json({
          usuario: quem,
          temToken: !!env.AI_PROXY_TOKEN,
          modelo: env.AI_MODEL || 'gpt-5.5',
          webhookConfigurado: !!urlWebhook,
          autoAtivo: autoAtivo !== 'nao',
          temaFixo,
          proximaReuniao: proximaReuniaoISO(),
          direcao: {
            tema: abertas.tema ? abertas.tema.texto : '',
            feedbacks: abertas.feedbacks.length,
            demandas: abertas.demandas.length,
            // Pedido esquecido é o que faz alguém parar de pedir: a tela avisa.
            demandasParadas: abertas.demandas.filter((d) => d.rodadas >= 3).length,
          },
          agentes: AGENTES.map((a) => {
            const d = mapa.get(a.chave);
            const pessoa = PESSOAS[a.chave];
            return {
              chave: a.chave, nome: a.nome, oque: a.oque, area: a.area, fora: a.fora, fonte: a.fonte,
              // O nome curto é o que aparece na sala: gente é chamada pelo
              // nome, não pelo cargo.
              pessoa: pessoa ? {
                nome: pessoa.nome, nomeCompleto: pessoa.nomeCompleto, idade: pessoa.idade,
                deOndeVeio: pessoa.deOndeVeio, oQueIrrita: pessoa.oQueIrrita,
                foraDoTrabalho: pessoa.foraDoTrabalho, papel: a.papel,
              } : null,
              modoTexto: !!a.modoTexto, opinaEmTudo: !!a.opinaEmTudo, paleta: a.paleta,
              exemplo: a.exemplo, dono: d ? String(d.dono) : '',
              system: d && String(d.prompt) ? String(d.prompt) : a.system,
              customizado: !!(d && String(d.prompt)),
            };
          }),
          execucoes: execs.rows,
        });
      }

      // Tudo que a salinha 16-bit precisa pra reencenar a última reunião.
      if (p === '/api/sala') {
        const pedida = (url.searchParams.get('sessao') || '').slice(0, 80);
        const ataQ = pedida
          ? await env.DB.query('SELECT * FROM atas WHERE sessao = ?', [pedida])
          : await env.DB.query('SELECT * FROM atas ORDER BY quando DESC LIMIT 1', []);
        const ata = ataQ.rows[0];
        if (!ata) return json({ ata: null, falas: [], proximaReuniao: proximaReuniaoISO() });

        const [falas, conversas, estados] = await Promise.all([
          env.DB.query('SELECT ordem, rodada, chave, texto FROM falas WHERE sessao = ? ORDER BY ordem', [String(ata.sessao)]),
          conversasRecentes(env, 6),
          env.DB.query('SELECT chave, humor, obsessao, o_que_me_trava FROM estado_agente', []),
        ]);
        const seguro = (s: unknown) => { try { return JSON.parse(String(s || '[]')); } catch { return []; } };
        return json({
          proximaReuniao: proximaReuniaoISO(),
          ata: {
            sessao: ata.sessao, tema: ata.tema, quando: ata.quando, automatica: !!ata.automatica,
            resumo: ata.resumo, resumo_curto: ata.resumo_curto, placar_vendas: ata.placar_vendas,
            webhook_status: ata.webhook_status, modo: ata.modo || 'completa',
            consenso: seguro(ata.consenso), divergencias: seguro(ata.divergencias), acoes: seguro(ata.acoes),
            recomendacoes: seguro(ata.recomendacoes), entregas: seguro(ata.entregas),
            reprovadas: seguro(ata.reprovadas),
            precisamos_de_voce: String(ata.precisamos_de_voce || ''),
          },
          falas: falas.rows,
          conversas,
          estados: estados.rows,
        });
      }

      if (p === '/api/atas') {
        const q = await env.DB.query(
          'SELECT sessao, tema, quando, automatica, resumo, resumo_curto, placar_vendas, webhook_status, modo, recomendacoes FROM atas ORDER BY quando DESC LIMIT 30', []);
        return json({ atas: q.rows });
      }

      if (p === '/api/boletim') {
        const { lerBoletim } = await import('./src/boletim');
        return json({ depoimentos: await lerBoletim(env, (url.searchParams.get('semana') || '').slice(0, 20)) });
      }

      if (p === '/api/memoria') {
        const chave = (url.searchParams.get('agente') || '').slice(0, 40);
        return json({ memoria: chave ? await lembrar(env, chave, 30) : await memoriaDaSala(env) });
      }

      if (p === '/api/config' && request.method === 'GET') {
        return json({
          webhook_url: await lerConfig(env, 'webhook_url'),
          webhook_por_secret: !!env.WEBHOOK_URL,
          auto_ativo: (await lerConfig(env, 'auto_ativo')) !== 'nao',
          tema_fixo: await lerConfig(env, 'tema_fixo'),
          boletim_ativo: (await lerConfig(env, 'boletim_ativo')) !== 'nao',
          email_para: await lerConfig(env, 'email_para'),
          email_de: await lerConfig(env, 'email_de'),
          email_webhook: await lerConfig(env, 'email_webhook'),
          vozao_ativo: (await lerConfig(env, 'vozao_ativo')) === 'sim',
          vozao_canal: (await lerConfig(env, 'vozao_canal')) || 'chat',
          vozao_chat_url: await lerConfig(env, 'vozao_chat_url'),
          // Secrets nunca voltam pra tela; o que a tela precisa saber é só se
          // existe um caminho de entrega configurado.
          temVozaoChatPorSecret: !!env.VOZAO_CHAT_URL,
          temEmailParaPorSecret: !!env.EMAIL_PARA,
          temResend: !!env.RESEND_API_KEY,
          proximaReuniao: proximaReuniaoISO(),
        });
      }

      if (p === '/api/config' && request.method === 'POST') {
        const b = (await request.json()) as {
          webhook_url?: string; auto_ativo?: boolean; tema_fixo?: string; boletim_ativo?: boolean;
          email_para?: string; email_de?: string; email_webhook?: string; vozao_ativo?: boolean;
          vozao_canal?: string; vozao_chat_url?: string;
        };
        if (b.webhook_url !== undefined) {
          const u = String(b.webhook_url).trim();
          if (u && !/^https:\/\//i.test(u)) return json({ error: 'A URL do webhook precisa começar com https://' }, 400);
          await gravarConfig(env, 'webhook_url', u.slice(0, 600));
        }
        if (b.auto_ativo !== undefined) await gravarConfig(env, 'auto_ativo', b.auto_ativo ? 'sim' : 'nao');
        if (b.tema_fixo !== undefined) await gravarConfig(env, 'tema_fixo', String(b.tema_fixo).trim().slice(0, 200));
        if (b.boletim_ativo !== undefined) await gravarConfig(env, 'boletim_ativo', b.boletim_ativo ? 'sim' : 'nao');
        if (b.email_para !== undefined) {
          const e = String(b.email_para).trim();
          if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return json({ error: 'Esse e-mail não parece válido.' }, 400);
          await gravarConfig(env, 'email_para', e.slice(0, 160));
        }
        if (b.email_de !== undefined) await gravarConfig(env, 'email_de', String(b.email_de).trim().slice(0, 160));
        if (b.email_webhook !== undefined) {
          const u = String(b.email_webhook).trim();
          if (u && !/^https:\/\//i.test(u)) return json({ error: 'A URL precisa começar com https://' }, 400);
          await gravarConfig(env, 'email_webhook', u.slice(0, 600));
        }
        if (b.vozao_ativo !== undefined) await gravarConfig(env, 'vozao_ativo', b.vozao_ativo ? 'sim' : 'nao');
        if (b.vozao_canal !== undefined) {
          const c = String(b.vozao_canal).trim();
          if (!['chat', 'email', 'ambos'].includes(c)) return json({ error: 'Canal tem que ser chat, email ou ambos.' }, 400);
          await gravarConfig(env, 'vozao_canal', c);
        }
        if (b.vozao_chat_url !== undefined) {
          const u = String(b.vozao_chat_url).trim();
          if (u && !/^https:\/\//i.test(u)) return json({ error: 'A URL do espaço precisa começar com https://' }, 400);
          await gravarConfig(env, 'vozao_chat_url', u.slice(0, 600));
        }
        return json({ ok: true });
      }

      if (p === '/api/webhook/testar' && request.method === 'POST') {
        const r = await dispararWebhook(env, {
          sessao: 'teste', tema: 'Teste de webhook da Sala de Guerra', quando: new Date().toISOString(),
          automatica: false,
          resumo: 'Se você está lendo isto, o webhook está ligado. As reuniões de verdade acontecem de 2 em 2 horas e chegam neste mesmo canal.',
          resumo_curto: 'Webhook ligado. A partir de agora a ata de cada reunião cai aqui, de 2 em 2 horas.',
          consenso: ['o canal está configurado certo'], divergencias: [],
          acoes: [{ agente: 'João', acao: 'nada — era só um teste' }],
          placar_vendas: '',
          recomendacoes: [{
            o_que: 'Nada a fazer — isto é um teste de canal',
            por_que: 'nenhuma reunião rodou aqui', quem: 'joao', ate_quando: '', risco: '',
          }],
          reprovadas: 0,
          entregas: [], precisamos_de_voce: '',
          url: url.origin + '/index.html', urlAta: url.origin + '/ata',
        });
        return json(r, r.ok ? 200 : 502);
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
          const d = resultado.dados as any;
          await registrarRecados(env, sessao, ag.chave, (d?.recados_para || []).slice(0, 6));
          if (d?.aprendi) await gravarMemoria(env, ag.chave, 'aprendi', d.aprendi, sessao);
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

      // "Convocar reunião" à mão — mesmo motor da automática (rodadas, debate,
      // memória, ata), só que com tema escolhido por quem clicou.
      if (p === '/api/reuniao' && request.method === 'POST') {
        const b = (await request.json()) as { sessao?: string; tema?: string; webhook?: boolean };
        const r = await rodarReuniao(env, { tema: String(b.tema || '').trim(), sessao: b.sessao, automatica: false });
        let entrega: { ok: boolean; detalhe: string } | null = null;
        if (b.webhook) {
          entrega = await dispararWebhook(env, paraWebhook(r, url.origin));
          await env.DB.exec('UPDATE atas SET webhook_status = ? WHERE sessao = ?',
            [(entrega.ok ? 'ok: ' : 'falhou: ') + entrega.detalhe, r.sessao]);
        }
        return json({ ...r, webhook: entrega });
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
