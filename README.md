# Sala de Guerra do Futebol

A agência interna de futebol da Gocase, feita de agentes de IA. Uma mesa de cinco
personagens (Téo, Rafa, Nina, Caio e Val) se reúne sozinha todo dia, lê o mercado
masculino e de futebol na internet aberta, e manda ao coordenador (João Wellington)
uma ata curta no Google Chat: um **parecer de coleção** (coleção estruturada,
cápsula, drops isolados ou segurar) e os **jogos da semana** dos clubes licenciados.

- Produção: https://sala-guerra-futebol.devgogroup.com/ (GoDeploy, app `b5224503`, login Gogroup)
- Ata de uma reunião: `/ata?sessao=<id>` · a salinha animada: `/index.html`

## Como roda

É um único Worker (Cloudflare Workers, via GoDeploy), sem build e sem dependências:
o GoDeploy bundla o TypeScript no deploy. Estado no SQLite do app (`env.DB`).

```
worker.ts                rotas HTTP e /tasks/* (chamadas pelo cron do GoDeploy)
src/reuniao.ts           a reunião inteira, etapa por etapa (é o arquivo para ler primeiro)
src/agentes.ts           os 5 agentes: papel, fonte e prompt de cada um
src/pessoas.ts           a personalidade de cada um
src/mercado/parecer.ts   o comitê de coleção + banca cética (a decisão que vai no card)
src/mercado/leitura.ts   a leitura de mercado conferida pelo juiz
src/mercado/sintese.ts   a ata em 30 segundos (formato antigo, reserva do parecer)
src/juiz.ts              conferência em código: número inventado, ponte de produto, repetição
src/agenda.ts            jogos da semana (Série A e B), sem IA
src/web/*                fontes abertas: calendário e tabela (globoesporte), procura
                         (Wikipédia), vitrine (lojas Shopify), estética, notícias, torcida
src/webhook.ts           o card do Google Chat
src/paginaAta.ts         a página /ata
public/                  front estático (index.html, painel.js, sala.js, sala.css…)
test/                    testes de unidade (rodam sem rede e sem IA)
```

### O que acontece sozinho (cron do GoDeploy)

| Rota | Quando | O que faz |
|---|---|---|
| `POST /tasks/reuniao` | todo dia, 8h | a mesa se reúne, grava a ata e manda o card no Chat |
| `POST /tasks/boletim` | segunda | cada agente escreve seu depoimento da semana |
| `POST /tasks/vozao` | todo dia, 9h | o Torcedor manda o recado do Ceará |
| `POST /tasks/sentinela` | todo dia, 10h | avisa se a mesa calou |

Qualquer uma roda à mão com `?manual=1`.

### Rotas úteis para testar sem mexer em nada

- `GET /api/parecer/previa?pauta=...` roda o comitê de coleção ao vivo e devolve o card, sem gravar nem enviar.
- `GET /api/agenda` mostra a agenda de jogos de agora.
- `GET /api/sintese/previa?sessao=...` refaz a síntese de uma ata gravada.

## Rodar os testes

```bash
sh test/rodar.sh
```

Usa `npx tsx`; precisa só de Node. Para checar tipos:

```bash
npx -p typescript tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom --skipLibCheck worker.ts
```

## Segredos (ficam no GoDeploy, nunca no repositório)

`AI_PROXY_TOKEN` (obrigatório; sem ele não há IA), `AI_PROXY_URL`, `AI_MODEL`
(padrão `gpt-5.5`), `WEBHOOK_URL` (Chat das atas; também editável na tela),
`VOZAO_CHAT_URL`, `RESEND_API_KEY`, `EMAIL_DE`, `EMAIL_PARA`, `METABASE_API_KEY`.

Configurações editáveis na tela (⚙ Config, gravadas em `env.DB`): webhook, pauta fixa,
foco e margem da agenda de jogos (`agenda_foco`, `agenda_dias`), e-mail, Vozão.

## Deploy

O deploy é pelo GoDeploy (MCP `updateApp` ou o painel), não por push no GitHub — o
GitHub é só onde o código mora. Duas regras que já derrubaram produção:

1. **Suba todos os arquivos, sempre.** Todo `src/**/*.ts`, `worker.ts`, `package.json`
   e **os seis assets de `public/`** publicados na raiz (`index.html`, não
   `public/index.html`). Asset que fica fora do upload para de ser servido.
2. **Puxe antes de subir.** O `updateApp` substitui o app inteiro sem checar versão.
   Compare o `main` com o que está no ar antes de publicar.

Entrypoint: `worker.ts`.

## Princípios da mesa (leia antes de mexer em prompt)

- **Régua de qualidade é código, não prompt.** "Seja específico" no prompt o modelo
  aceita e desobedece. Número que ninguém mediu, peça em produto que a casa não fabrica,
  "coleção" com menos de quatro peças: tudo isso é cortado em código
  (`src/juiz.ts`, `validarParecer` em `src/mercado/parecer.ts`).
- **Decisão, não observação.** O coordenador sabe de cor o óbvio (camisa de clube
  vende, clube grande vende mais). O parecer tem que escolher um formato e dizer por quê.
- **Oferta não é procura.** Catálogo de loja é aposta da indústria; procura vem da
  Wikipédia e da tabela. Confiança "forte" sem procura é reprovada.
- **Fato vem com fonte.** Toda fonte é internet aberta e sem chave, consultada na hora.

Os comentários no topo de cada arquivo contam por que cada decisão foi tomada, com a
data e o pedido que a originou. Vale ler antes de desfazer algo.
