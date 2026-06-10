import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Lumina API",
      version: "1.0.0",
      description:
        "API do aplicativo Lumina — plataforma de leitura e comunidade literária. " +
        "Todos os endpoints protegidos exigem o header `Authorization: Bearer <token>`.",
    },
    servers: [
      { url: "http://localhost:5000", description: "Desenvolvimento local" },
      { url: "http://10.0.3.2:5000", description: "Emulador Genymotion" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
        },
        LoginRequest: {
          type: "object",
          required: ["email", "senha"],
          properties: {
            email: { type: "string", format: "email", example: "user@email.com" },
            senha: { type: "string", example: "senha123" },
          },
        },
        LoginResponse: {
          type: "object",
          properties: {
            token: { type: "string" },
            user: { $ref: "#/components/schemas/UserProfile" },
          },
        },
        UserProfile: {
          type: "object",
          properties: {
            id: { type: "integer" },
            nome: { type: "string" },
            email: { type: "string" },
            papel: { type: "string", enum: ["admin", "editor", "leitor"] },
            imagem_url: { type: "string", nullable: true },
            bio: { type: "string", nullable: true },
            criado_em: { type: "string", format: "date-time" },
          },
        },
        Book: {
          type: "object",
          properties: {
            id: { type: "integer" },
            titulo: { type: "string" },
            autor: { type: "string" },
            isbn: { type: "string", nullable: true },
            descricao: { type: "string", nullable: true },
            preco: { type: "number", nullable: true },
            imagem_url: { type: "string", nullable: true },
            genero: { type: "string", nullable: true },
            condicao: { type: "string", nullable: true },
            quantidade: { type: "integer", nullable: true },
            status: { type: "string", nullable: true },
          },
        },
        FeedItem: {
          type: "object",
          properties: {
            id: { type: "integer" },
            leitor: { $ref: "#/components/schemas/UserProfile" },
            livro: { $ref: "#/components/schemas/Book" },
            status: { type: "string" },
            nota: { type: "number", nullable: true },
            comentario: { type: "string", nullable: true },
            criado_em: { type: "string", format: "date-time", nullable: true },
            likes_count: { type: "integer" },
            comments_count: { type: "integer" },
            liked_by_me: { type: "boolean" },
          },
        },
        PaginatedFeed: {
          type: "object",
          properties: {
            items: { type: "array", items: { $ref: "#/components/schemas/FeedItem" } },
            total: { type: "integer" },
            pages: { type: "integer" },
            page: { type: "integer" },
          },
        },
      },
    },
    tags: [
      { name: "Auth", description: "Autenticação e perfil do usuário" },
      { name: "Reader", description: "Endpoints do leitor (feed, leituras, livros, pedidos)" },
      { name: "Editor", description: "Gestão de livros e leituras (papel editor)" },
      { name: "Admin", description: "Administração da plataforma" },
    ],
    paths: {
      // ─── AUTH ──────────────────────────────────────────────────────────────────
      "/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Login",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } },
          },
          responses: {
            200: { description: "Login bem-sucedido", content: { "application/json": { schema: { $ref: "#/components/schemas/LoginResponse" } } } },
            401: { description: "Credenciais inválidas", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/auth/register": {
        post: {
          tags: ["Auth"],
          summary: "Cadastro de novo usuário",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["nome", "email", "senha"],
                  properties: {
                    nome: { type: "string" },
                    email: { type: "string", format: "email" },
                    senha: { type: "string" },
                    bio: { type: "string" },
                    imagem: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "Usuário criado", content: { "application/json": { schema: { $ref: "#/components/schemas/LoginResponse" } } } },
            400: { description: "Dados inválidos ou email já cadastrado" },
          },
        },
      },
      "/auth/me": {
        get: {
          tags: ["Auth"],
          summary: "Retorna dados do usuário autenticado",
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Perfil do usuário", content: { "application/json": { schema: { $ref: "#/components/schemas/UserProfile" } } } },
            401: { description: "Não autenticado" },
          },
        },
      },
      "/auth/me/update": {
        put: {
          tags: ["Auth"],
          summary: "Atualiza perfil do usuário autenticado",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    nome: { type: "string" },
                    bio: { type: "string" },
                    senha: { type: "string" },
                    imagem: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Perfil atualizado" },
            401: { description: "Não autenticado" },
          },
        },
      },
      // ─── READER ────────────────────────────────────────────────────────────────
      "/reader/random-quote": {
        get: {
          tags: ["Reader"],
          summary: "Retorna uma citação aleatória de livro",
          responses: {
            200: { description: "Citação aleatória" },
            404: { description: "Nenhuma citação encontrada" },
          },
        },
      },
      "/reader/feed": {
        get: {
          tags: ["Reader"],
          summary: "Feed social de leituras",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "per_page", in: "query", schema: { type: "integer", default: 10 } },
          ],
          responses: {
            200: { description: "Feed paginado", content: { "application/json": { schema: { $ref: "#/components/schemas/PaginatedFeed" } } } },
          },
        },
      },
      "/reader/feed/{id}/like": {
        post: {
          tags: ["Reader"],
          summary: "Curtir / descurtir item do feed",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: { description: "Estado do like atualizado" },
            404: { description: "Leitura não encontrada" },
          },
        },
      },
      "/reader/feed/{id}/comments": {
        get: {
          tags: ["Reader"],
          summary: "Lista comentários de um item do feed",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Lista de comentários" } },
        },
        post: {
          tags: ["Reader"],
          summary: "Adiciona comentário a um item do feed",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", properties: { texto: { type: "string" } } } } },
          },
          responses: { 201: { description: "Comentário criado" } },
        },
      },
      "/reader/books": {
        get: {
          tags: ["Reader"],
          summary: "Lista livros disponíveis",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "per_page", in: "query", schema: { type: "integer", default: 10 } },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "genero", in: "query", schema: { type: "string" } },
          ],
          responses: { 200: { description: "Lista de livros paginada" } },
        },
      },
      "/reader/books/{id}": {
        get: {
          tags: ["Reader"],
          summary: "Detalhes de um livro",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: { description: "Detalhes do livro" },
            404: { description: "Livro não encontrado" },
          },
        },
      },
      "/reader/orders": {
        get: {
          tags: ["Reader"],
          summary: "Lista pedidos do usuário autenticado",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Lista de pedidos" } },
        },
        post: {
          tags: ["Reader"],
          summary: "Criar novo pedido",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items"],
                  properties: {
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          livro_id: { type: "integer" },
                          quantidade: { type: "integer" },
                        },
                      },
                    },
                    endereco_entrega: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Pedido criado" } },
        },
      },
      "/reader/orders/{id}": {
        get: {
          tags: ["Reader"],
          summary: "Detalhes de um pedido",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: { description: "Detalhes do pedido" },
            404: { description: "Pedido não encontrado" },
          },
        },
      },
      "/reader/leituras": {
        get: {
          tags: ["Reader"],
          summary: "Lista leituras do usuário autenticado",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Lista de leituras" } },
        },
        post: {
          tags: ["Reader"],
          summary: "Registrar nova leitura",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["livro_id", "status"],
                  properties: {
                    livro_id: { type: "integer" },
                    status: { type: "string", enum: ["quero_ler", "lendo", "lido"] },
                    nota: { type: "number", nullable: true },
                    comentario: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Leitura registrada" } },
        },
      },
      "/reader/profile/{id}": {
        get: {
          tags: ["Reader"],
          summary: "Perfil público de um leitor",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: { description: "Perfil público" },
            404: { description: "Usuário não encontrado" },
          },
        },
      },
      // ─── EDITOR ────────────────────────────────────────────────────────────────
      "/editor/books": {
        get: {
          tags: ["Editor"],
          summary: "Lista livros (painel editor)",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Lista de livros" } },
        },
        post: {
          tags: ["Editor"],
          summary: "Criar novo livro",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["titulo", "autor"],
                  properties: {
                    titulo: { type: "string" },
                    autor: { type: "string" },
                    isbn: { type: "string" },
                    descricao: { type: "string" },
                    preco: { type: "number" },
                    genero: { type: "string" },
                    condicao: { type: "string" },
                    quantidade: { type: "integer" },
                    imagem: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Livro criado" } },
        },
      },
      "/editor/books/{id}": {
        put: {
          tags: ["Editor"],
          summary: "Atualizar livro",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            content: { "multipart/form-data": { schema: { $ref: "#/components/schemas/Book" } } },
          },
          responses: { 200: { description: "Livro atualizado" } },
        },
        delete: {
          tags: ["Editor"],
          summary: "Excluir livro",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Livro excluído" } },
        },
      },
      // ─── ADMIN ─────────────────────────────────────────────────────────────────
      "/admin/users": {
        get: {
          tags: ["Admin"],
          summary: "Lista todos os usuários",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Lista de usuários" } },
        },
      },
      "/admin/users/{id}": {
        put: {
          tags: ["Admin"],
          summary: "Atualiza papel/status de um usuário",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    papel: { type: "string", enum: ["admin", "editor", "leitor"] },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Usuário atualizado" } },
        },
        delete: {
          tags: ["Admin"],
          summary: "Remove um usuário",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { 200: { description: "Usuário removido" } },
        },
      },
      "/admin/orders": {
        get: {
          tags: ["Admin"],
          summary: "Lista todos os pedidos",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: "Lista de pedidos" } },
        },
      },
      "/admin/orders/{id}/status": {
        put: {
          tags: ["Admin"],
          summary: "Atualiza status de um pedido",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status"],
                  properties: {
                    status: { type: "string", enum: ["pendente", "confirmado", "enviado", "entregue", "cancelado"] },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Status atualizado" } },
        },
      },
    },
  },
  apis: [], // paths definidos inline acima
};

export const swaggerSpec = swaggerJsdoc(options);
