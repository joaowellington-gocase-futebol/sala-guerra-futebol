#!/bin/sh
# Os testes rodam com tsx porque o app não tem build: o GoDeploy bundla na hora
# do deploy. tsx executa o TypeScript direto, sem passo intermediário e sem
# node_modules no repositório.
set -e
cd "$(dirname "$0")/.."
npx --yes tsx test/juiz.ts
npx --yes tsx test/sintese.ts
npx --yes tsx test/parecer.ts
npx --yes tsx test/agenda.ts
