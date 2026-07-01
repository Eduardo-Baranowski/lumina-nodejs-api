# 03 - Especificação Técnica do Backend Lumina

## 1. Visão Geral

Este documento descreve o escopo técnico, a arquitetura, os contratos de API, os modelos de dados e as regras de autenticação do backend **Lumina**.

O backend é implementado em **Node.js** com **Express** e **TypeORM**, e serve como a fonte de verdade para a aplicação móvel e demais clientes REST.

## 2. Arquitetura

- **Servidor HTTP:** Express
- **ORM:** TypeORM
- **Banco de Dados:** PostgreSQL (via `DATABASE_URL`)
- **Autenticação:** JWT com `process.env.JWT_SECRET`
- **Controle de acesso:** Middleware de autenticação e autorização por papel
- **Documentação de API:** Swagger em `/api-docs` e `/api-docs.json`
- **Uploads:** diretórios de upload locais em desenvolvimento e `/tmp/uploads` em ambientes serverless

## 3. Dependências principais

- `express`
- `typeorm`
- `pg`
- `jsonwebtoken`
- `bcryptjs`
- `cors`
- `swagger-jsdoc`
- `swagger-ui-express`

## 4. Variáveis de Ambiente

- `DATABASE_URL` — string de conexão PostgreSQL
- `JWT_SECRET` — chave secreta para assinatura de tokens JWT
- `ADMIN_INITIAL_EMAIL` — email do administrador inicial
- `ADMIN_INITIAL_PASSWORD` — senha do administrador inicial
- `VERCEL` — define ambiente serverless quando igual a `1`

## 5. Modelos de Dados Principais

### Usuário (`User`)

Campos principais:
- `id`
- `nome`
- `email`
- `senha_hash`
- `papel` (`admin`, `editor`, `leitor`)
- `imagem`
- `headline`
- `bio`

### Livro (`Livro`)
- `id`
- `titulo`
- `descricao`
- `preco`
- `estoque`
- `slug`
- `imagem`
- `disponivel`

### Solicitação (`Request`)
- `id`
- `titulo`
- `descricao`
- `status`
- `resposta`
- `user`

### Outros modelos de domínio
- `Leitura`
- `Compra`
- `Pedido`
- `ItemPedido`
- `Follow`
- `Friendship`
- `Message`
- `FeedLike`
- `FeedComment`
- `BookClub`, `BookClubMember`, `BookClubCycle`, `BookClubNomination`, `BookClubVote`
- `Endereco`
- `Editora`
- `Autor`, `LivroAutor`, `Nacionalidade`

## 6. Contratos de API

### 6.1 Autenticação

#### POST /auth/register

Requisição:
- `nome` (string)
- `email` (string)
- `senha` (string)

Resposta esperada:
- `201 Created`
- `{ message: "Leitor cadastrado com sucesso" }`

Erros:
- `400 Bad Request` quando faltar campo obrigatório
- `400 Bad Request` quando o email já estiver cadastrado

#### POST /auth/login

Requisição:
- `email` (string)
- `senha` (string)

Resposta esperada:
- `200 OK`
- `{ token_sessao, papel, nome, imagem_url }`

Erros:
- `400 Bad Request` quando campos obrigatórios estiverem ausentes
- `401 Unauthorized` quando credenciais inválidas

### 6.2 Saúde da API

#### GET /health

Resposta esperada:
- `200 OK`
- `{ status: "ok", timestamp: string }`

### 6.3 Documentação de API

#### GET /api-docs

Retorna a interface Swagger UI embutida.

#### GET /api-docs.json

Retorna o JSON da especificação OpenAPI.

### 6.4 Autorização e Papéis

A autenticação JWT é exigida em rotas que acessam dados privados. O middleware deve:

- validar o cabeçalho `Authorization: Bearer <token>`
- retornar `401` quando o token estiver ausente ou inválido
- associar `req.user` com `id` e `papel`
- usar `requireRole("admin")` ou `requireRole("editor")` para restringir acesso às rotas apropriadas

## 7. Regras de Negócio Relevantes

- O papel padrão de novos registros via `/auth/register` é `leitor`.
- O administrador inicial é criado automaticamente se as variáveis de ambiente estiverem definidas.
- Os uploads usam diretórios locais em desenvolvimento e `/tmp/uploads` em serverless.
- Rotas expostas em `/admin`, `/editor`, `/reader` e `/reader/book-club` são protegidas por autenticação.

## 8. Critérios de Aceite

- O backend responde aos contratos descritos com status HTTP corretos.
- A autenticação JWT é consistente e as mensagens de erro em rotas protegidas estão em português.
- A documentação de API está disponível em `/api-docs`.
- O projeto possui arquivos de documentação de especificação e testes alinhados ao estado real do código.
