# Lumina Backend

Backend Node.js do projeto Lumina, responsável por fornecer a API REST para o aplicativo móvel e demais clientes.

## Visão Geral

- **Servidor:** Express
- **Banco de Dados:** PostgreSQL via TypeORM
- **Autenticação:** JWT
- **Documentação de API:** Swagger

## Instalação

```bash
cd /home/ebaranowski/Documents/dev/backend-lumina-node
npm install
```

## Variáveis de Ambiente

Crie um arquivo `.env` com as variáveis mínimas:

```env
DATABASE_URL=postgresql://user:senha@host:5432/banco
JWT_SECRET=sua_chave_jwt
ADMIN_INITIAL_EMAIL=admin@example.com
ADMIN_INITIAL_PASSWORD=SenhaSegura123
```

## Executar em Desenvolvimento

```bash
npm run dev
```

## Testes

```bash
npm test
```

## Documentação

- `doc/03-especs.md` — especificação técnica do backend
- `doc/testing.md` — plano de testes do backend
- `/api-docs` — interface Swagger UI
- `/api-docs.json` — especificação OpenAPI

## Dependências

- Node.js
- npm
- PostgreSQL

## Observações

Este repositório traduz as rotas do backend atual em um contrato estável para consumo do frontend móvel e demais clientes.
