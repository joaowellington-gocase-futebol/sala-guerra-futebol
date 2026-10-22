# Instruções para agentes de código

Leia o `README.md` primeiro. O resumo do que importa ao mexer aqui:

- Código e comentários em português, no tom dos arquivos vizinhos. Cada arquivo abre
  com um comentário dizendo por que existe; mantenha esse padrão em arquivo novo.
- Sem dependências e sem build: o GoDeploy bundla `worker.ts` no deploy. Não adicione
  pacote npm.
- Antes de entregar: `sh test/rodar.sh` verde e o `tsc` do README sem erro. Teste novo
  vai em `test/` e entra no `test/rodar.sh`.
- Regra de qualidade da mesa vai em código (validação), não só no prompt.
- Nunca escreva segredo no repositório. Eles ficam no GoDeploy (lista no README).
- Deploy é pelo GoDeploy, com todos os arquivos e os seis assets de `public/` na raiz.
  Push no GitHub não publica nada.
