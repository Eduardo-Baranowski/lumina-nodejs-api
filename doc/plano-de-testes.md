# Plano de Testes (TDD First) — Lumina Mobile

Documentacao tecnica unificada do plano de testes para o ecossistema **Bibliotheca / Lumina Library**:

| Projeto | Stack | Caminho |
| :--- | :--- | :--- |
| **API Backend** | Node.js, Express, TypeORM, PostgreSQL | `lumina-nodejs-api` |
| **App Mobile** | Flutter, Dart, Riverpod, GoRouter | `il-libro-amico-mobile` |

Alinhado a `project_specification.md` (mobile) e ao contrato HTTP consumido pelos repositorios em `lib/data/*.dart`.

---

## 1. Objetivo

Definir uma estrategia de testes automatizados com abordagem **TDD First** para validar as funcionalidades criticas do sistema mobile Lumina — API REST e aplicativo Flutter — reduzindo risco de regressao e garantindo evolucao segura em ambas as camadas.

A API e a fonte de verdade dos dados; o app mobile e o cliente principal. Os testes devem garantir contratos HTTP estaveis **e** comportamento correto da UI, estado local e navegacao.

## 2. Escopo de Teste

### 2.1 API Backend (`lumina-nodejs-api`)

- Controllers REST em `src/controllers/*.ts`
- Middlewares JWT e autorizacao por papel em `src/middlewares/auth.ts`
- Entidades TypeORM: `User`, `Livro`, `Leitura`, `Request`, `Compra`, `Pedido`, `Message`, `Follow`, `Friendship`, `FeedLike`, `FeedComment`, `Endereco`, `BookClub*`
- Modulo de clube do livro (`/reader/book-club/*`)
- Banco PostgreSQL isolado por suite de teste

### 2.2 App Mobile (`il-libro-amico-mobile`)

- Telas em `lib/features/**/*.dart`
- Estado Riverpod (`AuthNotifier`, `CartNotifier`, `AddressNotifier`)
- Cliente HTTP e modelos (`lib/core/api/`, `lib/core/models/`)
- Roteamento e guards (`lib/routing/app_router.dart`)
- Persistencia local (`TokenStorage`, `OnboardingStorage`, `ApiConfig`)
- Repositorios em `lib/data/*.dart`

### 2.3 Fora de escopo

- Testes de carga/performance
- Deploy serverless (Vercel), migracao Cloudinary e infraestrutura Docker
- Publicacao em lojas (Play Store / App Store)
- Validacao visual pixel-perfect do tema Stitch

## 3. Estrategia TDD First

Para cada funcionalidade, em **API e Mobile**:

1. **Red** — escrever primeiro o teste do comportamento esperado (status HTTP, payload JSON, estado, widget ou navegacao).
2. **Green** — implementar codigo minimo para passar.
3. **Refactor** — limpar duplicacao sem alterar comportamento.
4. **Regression gate** — executar suite completa antes de merge.

Ordem recomendada na piramide:

```text
        /  E2E (integration_test)  \        ← poucos, fluxos criticos
       /   Widget + API integracao   \
      /  Unit (notifiers, models, API) \
     /________________________________\
```

## 4. Arquitetura das Suites de Teste

### 4.1 API — `lumina-nodejs-api/tests/`

```text
tests/
  setup.ts
  helpers/
    auth.ts
    factories.ts
  auth.test.ts
  security.test.ts
  reader.test.ts
  reader-social.test.ts
  reader-commerce.test.ts
  reader-profile.test.ts
  editor.test.ts
  admin.test.ts
  bookClub.test.ts
```

Praticas: **Jest + Supertest**, banco resetado entre suites, fixtures `adminToken`, `editorToken`, `readerToken`, assert de contrato `{ items, total, page, pages }`.

### 4.2 Mobile — `il-libro-amico-mobile/test/`

```text
test/
  unit/
    models/
    auth_notifier_test.dart
    cart_notifier_test.dart
    api_client_test.dart
    jwt_utils_test.dart
    repositories/
  widget/
    auth/
    home/
    books/
    cart/
    routing/
  fixtures/
  widget_test.dart              # smoke test existente

integration_test/
  auth_flow_test.dart
  reading_flow_test.dart
  checkout_flow_test.dart
```

Praticas: **flutter_test**, overrides Riverpod, `mocktail` para ApiClient/repositorios, integration tests contra API de teste.

---

## 5. Plano de Casos Criticos — API Backend

### 5.1 Autenticacao (`/auth`)

1. **Registro de leitor** — `POST /auth/register` → `201`, papel `leitor`.
2. **Email duplicado** → `400`.
3. **Login** — credenciais validas → `200`, `token_sessao`, `papel`, `nome`, `imagem_url`.
4. **Credenciais invalidas** → `401`.
5. **Campos obrigatorios ausentes** → `400`.

### 5.2 Leitor — Catalogo e Leituras (`/reader`)

1. **Listar livros** — `GET /reader/books?genero=` → paginado.
2. **Detalhe** — `GET /reader/books/:id` → metadados e `my_reading`.
3. **Recomendacoes** — `GET /reader/recommendations` → `average_rating`, ordenacao por media.
4. **Busca** — `GET /reader/search?q=`.
5. **Registrar leitura** — `POST /reader/readings` → `201`.
6. **Atualizar leitura** — segundo POST mesmo livro → `200`.
7. **Nota invalida** — fora de `1..5` → `400`.
8. **Status invalido** → `400`.
9. **Listar/excluir leituras** — `GET/DELETE /reader/readings`.
10. **Citacao aleatoria** — `GET /reader/random-quote`.

### 5.3 Leitor — Social e Feed (`/reader`)

1. **Feed** — `GET /reader/feed` → `likes_count`, `comments_count`, `liked_by_me`.
2. **Curtir** — `POST /reader/feed/:id/like`.
3. **Comentarios** — `GET/POST /reader/feed/:id/comments`.
4. **Follow** — `POST/DELETE /reader/users/:id/follow`.
5. **Amizade** — `POST /reader/users/:id/connect`; aceitar/rejeitar em `/reader/friendships/:id/accept|reject`.
6. **Mensagens** — `GET/POST /reader/users/:id/messages` com `after_id`.
7. **Conversas** — `GET /reader/conversations`.
8. **Notificacoes** — `GET /reader/notifications`.
9. **Perfil publico** — `GET /reader/users/:id`, `/visit`.

### 5.4 Leitor — Comercio e Perfil (`/reader`)

1. **Compra** — `POST /reader/purchases` → baixa estoque; estoque zero → `400`.
2. **Pedido** — `POST /reader/orders` → `201`.
3. **Solicitacao a editora** — `POST/GET /reader/requests`.
4. **Perfil** — `GET/PUT /reader/profile`.
5. **Foto** — `POST /reader/profile/photo` (multipart).
6. **Senha** — `PUT /reader/profile/password`.
7. **Enderecos** — `GET/POST /reader/addresses`.
8. **Acesso negado** — token editor/admin em rota de leitor → `403`.

### 5.5 Editora (`/editor`)

1. **Catalogo** — `GET /editor/books?q=` → paginado, isolado por editora.
2. **Open Library** — `GET /editor/books/lookup?q=`.
3. **CRUD livro** — `POST/PUT /editor/books` (multipart).
4. **Remocao logica** — `DELETE /editor/books/:id` → estoque zero.
5. **Isolamento** — livro alheio → `404`.
6. **Solicitacoes** — `GET /editor/requests`; responder → `PUT /editor/requests/:id/respond`.
7. **Resposta duplicada** → `400`.

### 5.6 Admin (`/admin`)

1. **Usuarios** — `GET/POST /admin/users`.
2. **Papel invalido** → `400`.
3. **Relatorios** — `GET /admin/reports`.
4. **Export CSV** — `GET /admin/export-csv`.
5. **Nao-admin** → `403`.

### 5.7 Clube do Livro (`/reader/book-club`)

1. **Listar/criar** — `GET/POST /reader/book-club`.
2. **Entrar** — `POST /reader/book-club/join` (id ou codigo).
3. **Membros e solicitacoes** — rotas `/:clubId/members`, `/:clubId/requests`.
4. **Aprovar/rejeitar/convidar** — rotas do dono.
5. **Hub, indicacoes, votos** — max 3 votos por ciclo.
6. **Sorteio e novo ciclo** — `POST /:clubId/draw`, `/:clubId/cycle`.

### 5.8 Seguranca transversal (API)

1. Token ausente → `401`.
2. Token invalido/expirado → `401`.
3. Papel incorreto → `403`.
4. `GET /health` → `{ status: "ok" }`.

---

## 6. Plano de Casos Criticos — App Mobile

### 6.1 Bootstrap e Configuracao

1. App inicia com `ProviderScope` + `LuminaApp` (`test/widget_test.dart`).
2. `ApiConfig.baseUrl` — override, env `API_BASE_URL` ou fallback Android `10.0.3.2:5000`.
3. Persistencia de URL customizada em SharedPreferences.

### 6.2 Autenticacao e Sessao

1. Login valido → token, papel, nome persistidos.
2. Login invalido → erro na UI, sessao vazia.
3. Registro → fluxo `/cadastro` → `/cadastro/foto`.
4. Restauracao de sessao ao reabrir app.
5. Logout → storage limpo, redirect `/entrar`.
6. HTTP 401 → `onUnauthorized` encerra sessao.

### 6.3 Roteamento e Guards

1. Onboarding → `/boas-vindas` antes de rotas autenticadas.
2. Rotas protegidas (`/mensagens`, `/estante`, `/carrinho`, `/checkout`) → redirect `/entrar`.
3. `/admin/*` e `/editor/*` bloqueados por papel.
4. Usuario logado em `/entrar` → redirect `/`.
5. `/splash` gerencia navegacao inicial.

### 6.4 Home, Feed e Social

1. Destaques + feed paginado com pull-to-refresh e scroll infinito.
2. Curtir e comentar no feed.
3. Busca unificada (`/buscar`).
4. Mensagens — conversas, chat com polling 3s, mensagem vazia ignorada.

### 6.5 Catalogo, Leituras e Estante

1. Listagem com filtro `genero`/`condicao`.
2. Detalhe do livro — capa, preco, avaliacoes.
3. Registrar leitura — status, nota `1..5`, comentario.
4. Estante (`/estante`) — filtro por status, excluir leitura.
5. Vitrine da editora (`/editora/:id`).

### 6.6 Carrinho e Checkout

1. `CartNotifier` — add, remove, quantidade, subtotal.
2. Frete fixo R$ 5,50 e total calculado.
3. Checkout com endereco → `POST /reader/orders`.
4. Tela de confirmacao e estado de carrinho vazio.

### 6.7 Perfil, Editor, Admin e Clube

1. **Perfil** — editar dados, upload foto, configurar URL da API, perfil publico.
2. **Editora** — CRUD livros, auto-preenchimento Open Library, arquivar, responder solicitacoes.
3. **Admin** — listar/criar usuarios, relatorios, guards de rota.
4. **Clube do livro** — listar, criar, entrar por codigo, hub, indicar, votar (max 3), gerenciar membros.

### 6.8 Core (modelos e API client)

1. Parsing JSON robusto (`fromJson` com campos opcionais).
2. `ApiException` para 400/401/403/404/500.
3. Erro de rede (`SocketException`) com mensagem orientativa.
4. `userIdFromToken` extrai `sub` do JWT.

---

## 7. Matriz Mobile × API

| Feature | Mobile (repositorio/tela) | Endpoint API | Teste prioritario |
| :--- | :--- | :--- | :--- |
| Login/Registro | `AuthNotifier`, telas auth | `/auth/login`, `/auth/register` | API unit + mobile unit/widget |
| Feed | `HomeScreen`, `ReaderRepository.feed` | `/reader/feed` | API + mobile widget |
| Livros | `BooksScreen`, `ReaderRepository.books` | `/reader/books` | API + mobile widget |
| Leitura | `BookDetailScreen`, `registerReading` | `/reader/readings` | API + mobile integration |
| Carrinho | `CartNotifier`, checkout | `/reader/orders` | mobile unit + API commerce |
| Mensagens | `ChatScreen` | `/reader/users/:id/messages` | API social + mobile widget |
| Editora CRUD | `EditorBookFormScreen` | `/editor/books` | API + mobile widget |
| Admin | `AdminUsersScreen` | `/admin/users`, `/admin/reports` | API + mobile widget |
| Clube do livro | `BookClubHubScreen` | `/reader/book-club/*` | API + mobile integration |

---

## 8. Uso de Mocks

### 8.1 API

| Dependencia | Mock | Motivo |
| :--- | :--- | :--- |
| `services/bookLookup.ts` | fixture JSON | Open Library externa |
| `utils/image.ts` | URL fake | upload/Cloudinary |
| `realtime/hub.ts` | mock do hub | SSE nao deterministico |

Preferencia: integracao leve com banco real; mocks pontuais via `jest.mock`.

### 8.2 Mobile

| Dependencia | Mock | Motivo |
| :--- | :--- | :--- |
| `ApiClient` | `mocktail` / fake | isolar repositorios |
| `http.Client` | `MockClient` | testes de ApiClient |
| `SharedPreferences` | `setMockInitialValues` | storage local |
| Repositorios | Provider override | widget tests |

Integration tests mobile usam API real de teste ou fixtures JSON compartilhadas com a suite Node.

---

## 9. Fixtures e Helpers

### 9.1 API (`tests/helpers/`)

- Tokens por papel: `adminToken`, `editorToken`, `readerToken`
- `authHeader(token)` → `Authorization: Bearer ...`
- Factories: `createBook`, `createReading`, `createBookClub`

### 9.2 Mobile (`test/fixtures/`)

```text
login_response.json
books_page.json
feed_page.json
book_details.json
book_club_hub.json
```

Helpers Dart: `pumpApp()`, `mockAuth({role})`, `fakePaginatedBooks(count)`.

---

## 10. Pipeline de Execucao

### 10.1 API

```bash
cd lumina-nodejs-api
npm install
npm run test
npm run test:coverage
```

Scripts sugeridos:

```json
{ "test": "jest --runInBand", "test:coverage": "jest --coverage --runInBand" }
```

Smoke test complementar: `./test-profile-routes.sh`.

### 10.2 Mobile

```bash
cd il-libro-amico-mobile
flutter pub get
flutter analyze
flutter test
flutter test --coverage
flutter test integration_test/
```

### 10.3 Gate de qualidade (ambos os projetos)

- PR bloqueado se qualquer teste falhar.
- Bugfix inclui teste de regressao.
- Cobertura meta: **80%** em `src/controllers/` (API); **70%** em `lib/core/` e `lib/data/` (mobile).

---

## 11. Ordem de Implementacao TDD (roadmap unificado)

| Etapa | API | Mobile |
| :---: | :--- | :--- |
| 1 | `security.test.ts` | `test/unit/models/` |
| 2 | `auth.test.ts` | `api_client_test.dart` |
| 3 | `reader.test.ts` | `auth_notifier_test.dart` |
| 4 | `reader-commerce.test.ts` | `cart_notifier_test.dart` |
| 5 | `reader-social.test.ts` | `test/unit/repositories/` |
| 6 | `reader-profile.test.ts` | `app_router_test.dart` |
| 7 | `editor.test.ts` | widget tests auth/books |
| 8 | `admin.test.ts` | widget tests cart/admin |
| 9 | `bookClub.test.ts` | widget tests book_club |
| 10 | — | `integration_test/` (fluxos E2E) |

Prioridade: contratos API estaveis **antes** dos integration tests mobile.

---

## 12. Dependencias de Teste

### 12.1 API (`devDependencies`)

- `jest`, `ts-jest`, `supertest`
- `@types/jest`, `@types/supertest`, `cross-env`

Variaveis (`.env.test`):

| Variavel | Finalidade |
| :--- | :--- |
| `DATABASE_URL` | Banco dedicado a testes |
| `JWT_SECRET` | Chave fixa para tokens previsiveis |
| `ADMIN_INITIAL_EMAIL` / `ADMIN_INITIAL_PASSWORD` | Seed do admin |

### 12.2 Mobile (`dev_dependencies`)

- `flutter_test` (ja presente)
- `mocktail`, `integration_test`, `network_image_mock` (recomendados)

| Parametro | Exemplo |
| :--- | :--- |
| `API_BASE_URL` | `http://10.0.2.2:5000` (emulador Android) |
| Credenciais E2E | usuarios seed da API de teste |
