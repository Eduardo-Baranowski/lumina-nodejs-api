# Plano de Testes do Backend Lumina

## 1. Objetivo

O objetivo deste documento é registrar os cenários de teste do backend, alinhados à especificação de API e às rotas atualmente disponíveis no projeto.

## 2. Comandos

- Instalar dependências: `npm install`
- Executar testes: `npm test`
- Executar testes em modo watch: `npm run test:watch`
- Gerar cobertura: `npm run test:coverage`

## 3. Ambientes de Teste

Os testes usam o ambiente `NODE_ENV=test`, configurado em `tests/setup.ts`.

## 4. Suites de Teste Existentes

### 4.1 Autenticação
- Validar registro de usuário via `/auth/register`
- Validar login via `/auth/login`
- Validar campos obrigatórios no payload
- Validar mensagem de erro em token ausente ou inválido

### 4.2 Segurança e Middleware
- `authMiddleware` deve bloquear requisições sem token
- `authMiddleware` deve bloquear tokens inválidos
- `authMiddleware` deve permitir rotas opcionais quando `optional=true`
- `requireRole` deve bloquear papéis incorretos
- `requireRole` deve permitir acesso quando o papel é correto

### 4.3 Saúde da API
- `GET /health` deve retornar `200` e um timestamp
- Rotas inexistentes devem retornar `404`

## 5. Novos Cenários Derivados de 03-especs.md

### Autenticação
- `POST /auth/register` retorna `201` com `message` quando cria um leitor
- `POST /auth/register` retorna `400` para email duplicado
- `POST /auth/login` retorna `200` com `token_sessao`, `papel`, `nome` e `imagem_url`
- `POST /auth/login` retorna `401` com mensagem de credenciais inválidas
- `POST /auth/login` retorna `400` quando email ou senha estiverem ausentes

### Documentação de API
- `GET /api-docs` deve expor a interface do Swagger UI
- `GET /api-docs.json` deve retornar a especificação OpenAPI válida

### Middleware de Autenticação
- `authMiddleware` retorna `401` com mensagem `Cabeçalho Authorization ausente`
- `authMiddleware` retorna `401` com mensagem `Token inválido ou expirado`

## 6. Processo de Atualização

1. Escrever/atualizar o teste para cada novo contrato.
2. Implementar ajuste de código mínimo para satisfazer o teste.
3. Executar `npm test` e confirmar que todas as suites passam.
4. Atualizar documentação se houver alterações no contrato ou nos fluxos.

## 7. Observações

A documentação e os testes devem refletir o estado atual do backend. Nenhuma funcionalidade extra deve ser introduzida além do que está descrito no arquivo de especificação.
