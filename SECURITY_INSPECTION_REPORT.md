# Segurança - Inspeção do Backend Lumina Node

## Resumo Executivo

Esta inspeção analisou o código do backend `backend-lumina-node` e o app mobile `mobile`, com foco em segurança de aplicação web, OWASP Top 10, controle de acesso, validação de entrada, uso de criptografia e configuração de ambiente.

- **Backend — Achados críticos:** 0
- **Backend — Achados altos:** 3
- **Backend — Achados médios:** 4
- **Backend — Achados baixos:** 2
- **Mobile — Achados críticos:** 0
- **Mobile — Achados altos:** 2
- **Mobile — Achados médios:** 1
- **Mobile — Achados baixos:** 0

### 5 Ações Mais Urgentes

1. **Exigir `JWT_SECRET` e falhar no boot se estiver ausente.** Hoje o backend tenta verificar tokens mesmo quando a secret está em branco.
2. **Restringir CORS para origens confiáveis.** `app.use(cors());` permite qualquer origem e aumenta o risco de CSRF/ataques de API cross-site.
3. **Proteger o token JWT no app mobile e usar armazenamento seguro.** O app ainda persiste sessão e credenciais em `SharedPreferences`, o que é insuficiente para dados sensíveis em dispositivos comprometidos.
4. **Eliminar ou proteger o acesso público a `/static/uploads`.** O diretório de upload está exposto sem controle e pode revelar arquivos sensíveis.
5. **Evitar URLs de API inseguras no mobile e exigir HTTPS sempre que possível.** A app permite overrides HTTP para dev e aceita URLs sem validação suficiente.

---

## Achados de Segurança

### 1. CORS permissivo e falha de configuração de segurança

- **Localização:** `src/index.ts:25`
- **Descrição:** O servidor usa `app.use(cors());` sem restrição de origens.
- **Evidência:** `app.use(cors());`
- **Impacto potencial:** Qualquer aplicação web maliciosa pode fazer requisições ao backend a partir de um navegador e potencialmente explorar APIs que confiam apenas em cookies ou headers.
- **Severidade:** Alta
- **Recomendação:** Configurar um allowlist de origens confiáveis, por exemplo:

```ts
app.use(
  cors({
    origin: [process.env.FRONTEND_URL, process.env.ADMIN_URL],
    credentials: true,
  })
);
```

- **Referências:** OWASP A05 Injection / A02 Security Misconfiguration, CWE-942 Permissive Cross-domain Policy

### 2. Exposição pública de uploads estáticos sem controle de acesso

- **Localização:** `src/index.ts:48`
- **Descrição:** O backend expõe o diretório de uploads (`/static/uploads`) sem autenticação ou validação adicional.
- **Evidência:** `app.use("/static/uploads", express.static(uploadRoot, { fallthrough: true }));`
- **Impacto potencial:** Um atacante pode descobrir URLs de arquivos e acessar imagens e outros assets que deveriam ser restritos. Em casos de uploads maliciosos, poderá também servir conteúdo indesejado.
- **Severidade:** Alta
- **Recomendação:** Servir uploads via endpoint autenticado ou restringir o acesso direto; validar paths e usar um proxy que exija autorização.

- **Referências:** OWASP A01 Broken Access Control, CWE-200 Information Exposure

### 3. Validação de JWT insegura / lançamento com secret ausente

- **Localização:** `src/middlewares/auth.ts:28-33`
- **Descrição:** `jwt.verify` é chamado com `process.env.JWT_SECRET || ""`, o que permite startup com secret vazio e falha de autenticação previsível.
- **Evidência:** `const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as any;`
- **Impacto potencial:** Se `JWT_SECRET` não estiver definido corretamente, o servidor pode aceitar tokens inválidos ou ficar sem capacidade real de autenticar usuários.
- **Severidade:** Alta
- **Recomendação:** Exigir `JWT_SECRET` no bootstrap da aplicação e encerrar o processo se estiver ausente. Evitar fallback para string vazia.

```ts
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET deve estar definido");
}
```

- **Referências:** OWASP A05 Injection / A07 Authentication Failures, CWE-321 Use of Hard-coded Cryptographic Key

### 4. Rotas com autenticação opcional insuficiente / controle de acesso inconsistente

- **Localização:** `src/controllers/bookClub.ts:275` e outras rotas usando `authMiddleware(true)`
- **Descrição:** Algumas rotas usam `authMiddleware(true)`, que permite o fluxo continuar sem token se a autorização estiver ausente.
- **Evidência:** `bookClubRouter.get("/", authMiddleware(true), async (req: AuthRequest, res: Response) => {`.
- **Impacto potencial:** Pode expor dados de clubes ou permitir comportamentos inconsistentes em endpoints que assumem usuário autenticado.
- **Severidade:** Média
- **Recomendação:** Usar autenticação obrigatória em endpoints que retornam dados específicos de usuário ou de clubes, ou tratar claramente casos anônimos.

- **Referências:** OWASP A01 Broken Access Control, CWE-306 Missing Authentication for Critical Function

### 5. Falhas de configuração no acesso ao banco de dados e SSL relaxado

- **Localização:** `src/config/database.ts:33-37`
- **Descrição:** `ssl` em produção está configurado como `{ rejectUnauthorized: false }`.
- **Evidência:** `ssl: isProduction ? { rejectUnauthorized: false } : false,`
- **Impacto potencial:** Conexão ao banco de dados pode ser interceptada ou aceitação de certificados inválidos em ambientes de produção.
- **Severidade:** Média
- **Recomendação:** Usar verificação de certificado TLS adequada e evitar `rejectUnauthorized: false` em produção.

- **Referências:** OWASP A02 Security Misconfiguration, CWE-295 Improper Certificate Validation

### 6. Possível falta de segurança de cabeçalhos HTTP e hardening do Express

- **Localização:** `src/index.ts`
- **Descrição:** Não há uso de middleware de segurança como `helmet` nem inspeção de headers estritos.
- **Evidência:** Ausência de chamada a `helmet()` ou definição de headers como `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`.
- **Impacto potencial:** A aplicação fica mais exposta a ataques de clickjacking, MIME sniffing e outras falhas de configuração HTTP.
- **Severidade:** Média
- **Recomendação:** Adicionar `helmet()` e configurar políticas de segurança apropriadas.

- **Referências:** OWASP A02 Security Misconfiguration, CWE-16 Configuration

### 7. Exposição de credenciais e configuração de terceiros em código de produção

- **Localização:** `src/utils/image.ts:35-42` e `src/utils/image-migration.ts:14-17`
- **Descrição:** O código lê `CLOUDINARY_API_KEY` e `CLOUDINARY_API_SECRET` diretamente de variáveis de ambiente, mas não valida sua presença ou aplica proteção adicional.
- **Evidência:** `cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, });`
- **Impacto potencial:** Se o repositório for exposto ou se as variáveis forem definidas incorretamente, credenciais de terceiros podem ser comprometidas.
- **Severidade:** Média
- **Recomendação:** Garantir que variáveis sensíveis não sejam commitadas em arquivos de configuração; usar cofres/secret manager em produção e validar a presença no startup.

### 8. Diretório de upload local acessível em dev e serverless

- **Localização:** `src/index.ts:35-48` e `src/utils/image.ts:101-113`
- **Descrição:** Uploads locais são salvos em `static/uploads` ou `/tmp/uploads` e expostos publicamente.
- **Evidência:** `const uploadRoot = isServerless ? "/tmp/uploads" : path.join(__dirname, "../static/uploads");` + `app.use("/static/uploads", express.static(uploadRoot, { fallthrough: true }));`
- **Impacto potencial:** Um atacante que obtenha ou adivinhe um nome de arquivo pode acessar dados do usuário ou conteúdo não intencional.
- **Severidade:** Alta
- **Recomendação:** Se o conteúdo for restrito, não expô-lo diretamente; use um endpoint seguro ou marque arquivos com nomes imprevisíveis e verifique permissões.

### 9. Uso de `jsonwebtoken` em helpers sem validação centralizada

- **Localização:** `src/controllers/reader.ts:41-52`
- **Descrição:** A função `getOptionalUserId` verifica tokens de forma independente do middleware principal.
- **Evidência:** `const decoded = require("jsonwebtoken").verify(token, process.env.JWT_SECRET || "") as any;`
- **Impacto potencial:** Duplica lógica de autenticação e aumenta a chance de inconsistência na validação de token.
- **Severidade:** Baixa
- **Recomendação:** Reutilizar o middleware de autenticação central ou extrair a verificação para função compartilhada.

### 10. Possível risco de supply chain e dependências

- **Localização:** `package.json`
- **Descrição:** Dependências cruciais como `cors` e `jsonwebtoken` devem ser monitoradas continuamente para CVEs ou falhas de supply chain.
- **Evidência:** `"cors": "^2.8.5"`, `"jsonwebtoken": "^9.0.2"`.
- **Impacto potencial:** Vulnerabilidades em bibliotecas podem afetar diretamente a segurança do backend.
- **Severidade:** Baixa
- **Recomendação:** Adotar scanner de dependências e atualizar pacotes com correções de segurança.

---

## Inspeção do Mobile Lumina

### Resumo Executivo do Mobile

- **Achados críticos:** 0
- **Achados altos:** 2
- **Achados médios:** 1
- **Achados baixos:** 0

### 1. Armazenamento inseguro de token JWT no app mobile

- **Localização:** `mobile/lib/core/storage/token_storage.dart:17-30`
- **Descrição:** O app salva o token JWT e os dados de sessão em `SharedPreferences`.
- **Evidência:** `await prefs.setString(_tokenKey, token);`
- **Impacto potencial:** Tokens e dados de sessão podem ser expostos em dispositivos enraizados, backups locais e em instalações de terceiros. Um invasor local pode reutilizar o token para ações autenticadas.
- **Severidade:** Alta
- **Recomendação:** Migrar para armazenamento seguro (`flutter_secure_storage`, keychain/keystore), reduzir dados sensíveis persistidos e limpar sessão rigorosamente no logout.

### 2. Configuração de URL da API com suporte a HTTP inseguro

- **Localização:** `mobile/lib/config/api_config.dart:31-37`, `51-52`, `68-73`; `mobile/lib/features/profile/api_settings_tile.dart:54-56`
- **Descrição:** Embora a URL de produção padrão seja HTTPS, a app aceita overrides expostos ao usuário e possui presets HTTP para desenvolvimento.
- **Evidência:** `static const String productionUrl = 'https://lumina-nodejs-api.vercel.app';` e presets como `http://10.0.2.2:5000`, `http://127.0.0.1:5000`.
- **Impacto potencial:** Tráfego de rede pode ser transmitido em texto claro durante testes ou caso um override inseguro seja aplicado, expondo credenciais e tokens a interceptação.
- **Severidade:** Alta
- **Recomendação:** Validar e restringir URLs aceitas, exigir HTTPS para ambientes não locais e documentar claramente que somente a URL de desenvolvimento local deve usar HTTP.

### 3. Construção de URI sem validação de base URL

- **Localização:** `mobile/lib/core/api/api_client.dart:20-21`, `24-31`
- **Descrição:** A URI da requisição é montada diretamente a partir de `ApiConfig.instance.baseUrl` sem validação de esquema ou host.
- **Evidência:** `return Uri.parse('$base$normalized').replace(queryParameters: query);`
- **Impacto potencial:** URLs malformadas ou controladas pelo usuário podem gerar requisições para hosts não pretendidos ou esquemas inesperados.
- **Severidade:** Média
- **Recomendação:** Validar `baseUrl` como URL bem formada; permitir apenas `https://` e, em dev local, `http://` em hosts confiáveis; rejeitar overrides inválidos.

## Observações Gerais

- A base do projeto utiliza `TypeORM`/`Prisma` e `bcryptjs` com hash de senha adequado.
- A aplicação não valida `process.env.JWT_SECRET` nem `process.env.DATABASE_URL` no startup, o que deve ser corrigido.
- A presença de upload em memória (`multer.memoryStorage()`) é adequada, mas o fluxo de armazenamento de arquivos e exposição pública deve ser endurecido.

## Próximos Passos Recomendados

1. Implementar validações de variáveis de ambiente críticas no bootstrap da aplicação.
2. Aplicar hardening HTTP usando `helmet` e políticas CSP.
3. Revisar todos os endpoints que usam `authMiddleware(true)` e garantir comportamento seguro.
4. Proteger upload de arquivos e considerar servir arquivos via endpoint autenticado.
5. Monitorar dependências e configurar alertas de vulnerabilidade.
