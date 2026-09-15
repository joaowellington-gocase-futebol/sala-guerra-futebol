// A mensagem diária do Torcedor Fanático, das 9h.
//
// Pedido do João: o Rian (líder dele) recebe todo dia uma mensagem do Torcedor
// — futebol, foco no Ceará, com piada do time. A graça só existe se não for
// texto pronto, então ele escreve em cima das MANCHETES REAIS que já coleta
// por RSS. Quando o Vozão está no noticiário, ele puxa o fato; quando não
// está, ele diz que não teve notícia e arruma graça em outra coisa. Regra da
// casa, que vale até na brincadeira: o tom é do personagem, o fato é do dado.
//
// Dois canais, ligados de forma independente no ⚙ Config:
//   • Google Chat — um espaço com o João e o Rian, via webhook próprio
//     (`vozao_chat_url`, separado do webhook das atas pra não misturar).
//   • E-mail — via src/email.ts (Resend ou webhook de e-mail).

import type { Env } from './aiproxy';
import { chamarAgente } from './aiproxy';
import { buscarManchetesReais } from './fontes/noticiasFutebol';
import { enviarEmail } from './email';
import { postarNoChat } from './webhook';
import { lerConfig } from './db';

const SYSTEM =
  'Você é o TORCEDOR FANÁTICO DO CEARÁ, um dos 10 agentes da Sala de Guerra do Futebol — a agência interna de ' +
  'futebol da Gocase, tocada pelo João Wellington. Torcedor raiz do Vozão: alvinegro, Porangabuçu é o centro do ' +
  'mundo, e você acha mesmo que o Ceará é o maior do Nordeste. ' +
  'Todo dia de manhã você manda uma mensagem curta pro RIAN, que é o líder do João. Trate o Rian pelo nome, ' +
  'como quem puxa assunto de futebol no corredor — não como quem manda relatório. ' +
  '\n\nO QUE A MENSAGEM TEM QUE SER: futebol, com foco no Ceará, COM PIADA. Humor de torcedor mesmo: pode zoar ' +
  'rival, pode rir das desgraças do próprio Vozão (torcedor que só se elogia não tem graça), pode trocadilho ' +
  'ruim, pode drama de arquibancada. A piada é o ponto, não o enfeite — uma mensagem sem graça nenhuma é uma ' +
  'mensagem que falhou. ' +
  '\n\nREGRAS DURAS: ' +
  '(1) 2 a 4 frases. É mensagem de chat, não e-mail corporativo. Textão diário vira coisa que a pessoa aprende a ignorar. ' +
  '(2) Se houver manchete real do Ceará na entrada, ANCORE nela — a piada sai do fato de hoje. ' +
  '(3) Se NÃO houver manchete do Ceará, diga isso na brincadeira ("hoje o Vozão deu folga pra imprensa") e ' +
  'puxe graça de outra coisa que veio na entrada, ou da própria espera. NUNCA invente notícia, resultado, ' +
  'contratação, placar ou tabela que não veio na entrada — nem de brincadeira, nem "de leve". ' +
  '(4) Isto vai para o CHEFE DO JOÃO, num canal de trabalho: sem palavrão, sem xingar pessoa real (jogador, ' +
  'juiz ou dirigente com nome e sobrenome), sem baixaria. Zoeira de rival é do clube, não da pessoa. ' +
  '(5) No máximo um emoji. ' +
  '(6) Não peça nada ao Rian e não fale de trabalho, meta ou entrega. É futebol e só. ' +
  'Responda APENAS {"assunto":"<linha curta, serve de assunto do e-mail>","corpo":"<a mensagem>"}.';

export interface ResultadoVozao {
  ok: boolean;
  detalhe: string;
  assunto?: string;
  corpo?: string;
  canais?: { canal: string; ok: boolean; detalhe: string }[];
}

export async function mandarOVozao(env: Env): Promise<ResultadoVozao> {
  const [canalConfig, urlChat, emailPara] = await Promise.all([
    lerConfig(env, 'vozao_canal'),
    lerConfig(env, 'vozao_chat_url'),
    lerConfig(env, 'email_para'),
  ]);
  const canal = canalConfig || 'chat';
  const chatUrl = (urlChat || env.VOZAO_CHAT_URL || '').trim();
  const para = (emailPara || env.EMAIL_PARA || '').trim();

  const querChat = canal === 'chat' || canal === 'ambos';
  const querEmail = canal === 'email' || canal === 'ambos';
  if (querChat && !chatUrl && !querEmail) {
    return { ok: false, detalhe: 'sem webhook do espaço do Chat — cole a URL no ⚙ Config da sala' };
  }
  if (querEmail && !para && !querChat) {
    return { ok: false, detalhe: 'sem e-mail de destino — preencha no ⚙ Config da sala' };
  }

  // ── O fato antes da piada ────────────────────────────────────────────────
  const noticias = await buscarManchetesReais(env);
  const doCeara = noticias.manchetes.filter((m) => /cear[áa]|voz[ãa]o|porangabu[çc]u/i.test(m.titulo));
  const entrada = doCeara.length
    ? 'Manchetes REAIS do Ceará coletadas hoje:\n' + doCeara.map((m) => `- ${m.titulo} (${m.fonte}, ${m.data})`).join('\n')
    : 'Não saiu nenhuma manchete do Ceará nas fontes hoje.' +
      (noticias.manchetes.length
        ? ' O que saiu de futebol foi isto (pode alfinetar rival, mas sem inventar nada):\n' +
          noticias.manchetes.slice(0, 6).map((m) => `- ${m.titulo}`).join('\n')
        : ' As fontes de notícia também não trouxeram nada de ninguém hoje — a piada tem que sair da própria secura.');

  const r = await chamarAgente(env, SYSTEM, entrada, undefined, 0.9);
  if (!r.ok) return { ok: false, detalhe: 'o Torcedor não conseguiu escrever: ' + r.erro };

  const d = r.dados as any;
  const assunto = String(d?.assunto || 'O Ceará é grande e você sabe disso').slice(0, 160);
  const corpo = String(d?.corpo || '').trim();
  if (!corpo) return { ok: false, detalhe: 'o Torcedor respondeu vazio' };

  // ── Entrega ──────────────────────────────────────────────────────────────
  const canais: { canal: string; ok: boolean; detalhe: string }[] = [];

  if (querChat) {
    if (!chatUrl) {
      canais.push({ canal: 'chat', ok: false, detalhe: 'sem URL do espaço no ⚙ Config' });
    } else {
      // A assinatura não é enfeite: quem recebe tem que saber de onde vem e
      // como desligar, sem precisar perguntar.
      const r2 = await postarNoChat(chatUrl, [
        `*⚽ ${assunto}*`,
        '',
        corpo,
        '',
        '_Recado diário do Torcedor Fanático, um dos agentes da Sala de Guerra do Futebol do João. Se encher o saco, é só falar com ele._',
      ].join('\n'));
      canais.push({ canal: 'chat', ...r2 });
    }
  }

  if (querEmail) {
    if (!para) {
      canais.push({ canal: 'email', ok: false, detalhe: 'sem endereço no ⚙ Config' });
    } else {
      const r2 = await enviarEmail(env, {
        para, assunto,
        texto: corpo + '\n\n—\nRecado diário do Torcedor Fanático, um dos agentes da Sala de Guerra do Futebol da Gocase, tocada pelo João Wellington.\nPra parar de receber, é só falar com ele.',
      });
      canais.push({ canal: 'email', ...r2 });
    }
  }

  const entregou = canais.some((c) => c.ok);
  return {
    ok: entregou,
    detalhe: canais.map((c) => `${c.canal}: ${c.detalhe}`).join(' | ') || 'nenhum canal ligado',
    assunto, corpo, canais,
  };
}
