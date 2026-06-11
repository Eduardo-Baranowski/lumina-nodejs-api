# Solução de Upload de Imagens - Vercel & Cloudinary

## Problema
Vercel usa um filesystem **efêmero** em `/var/task`. Arquivos salvos lá desaparecem após a execução da função Lambda.

```
❌ Dev:  /var/task/static/uploads → PERDIDO após requisição
✅ Local: ./static/uploads → PERSISTE no disco
```

## Solução Implementada

### 1. **Detecção de Ambiente**
```typescript
const isServerless = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
const isCloudinaryEnabled = isServerless && process.env.CLOUDINARY_CLOUD_NAME;
```

### 2. **Roteamento de Upload**
- **Com Cloudinary + VERCEL=1**: Faz upload para CDN (URLs persistentes ✅)
- **Sem Cloudinary / Dev**: Usa `/tmp` ou `./static/uploads` (ephemeral/local)

```typescript
if (isCloudinaryEnabled) {
  // Upload para Cloudinary CDN
  return cloudinary.uploader.upload_stream(...)
} else {
  // Fallback: filesystem local
  fs.writeFileSync(targetPath, file.buffer);
}
```

### 3. **Configuração Necessária em Vercel**

No dashboard do Vercel, adicionar variáveis de ambiente:
```env
VERCEL=1  # (automaticamente setado por Vercel)
CLOUDINARY_CLOUD_NAME=seu_cloud_name
CLOUDINARY_API_KEY=sua_api_key
CLOUDINARY_API_SECRET=seu_api_secret
```

### 4. **Processo de Upload**

```
User picks image (mobile)
    ↓
POST /reader/profile/photo (multipart/form-data)
    ↓
Backend recebe arquivo em memoria (req.file.buffer)
    ↓
if (Cloudinary disponível?)
    ✅ cloudinary.uploader.upload_stream(file.buffer)
       → URL segura: https://res.cloudinary.com/...jpg
else
    📁 fs.writeFileSync(...) 
       → Path relativo: users/abc123def456.jpg
    ↓
Salva no banco: user.imagem = url/path
    ↓
Retorna: { imagem_url: "https://..." }
```

## Vantagens da Solução

| Aspecto | Dev | Vercel + Cloudinary |
|--------|-----|-------------------|
| Armazenamento | Disk local | CDN Global |
| Persistência | ✅ Permanente | ✅ Permanente |
| Velocidade | 🟡 Local | ✅ Otimizada |
| Custo | Grátis | Grátis (tier free) |
| Escalabilidade | 🟡 Limitado | ✅ Ilimitado |

## Como Configurar Cloudinary

1. **Criar conta gratuita**: https://cloudinary.com/users/register/free
2. **Obter credenciais**:
   - Dashboard → Account Details
   - Cloud Name, API Key, API Secret
3. **Adicionar em Vercel**:
   - Project Settings → Environment Variables
   - Adicionar os 3 valores

## Fallback em Produção

Se Cloudinary não estiver configurado em Vercel:
- Usa `/tmp/uploads` (ephemeral)
- ⚠️ Imagens serão perdidas em cold start
- **Recomendação**: Sempre configurar Cloudinary em produção

## Função `saveImage()` Atualizada

```typescript
export const saveImage = async (
  file: Express.Multer.File,
  subfolder: string
): Promise<string | null> => {
  if (isCloudinaryEnabled) {
    // Upload para Cloudinary
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `lumina/${subfolder}` },
        (error, result) => {
          if (error) reject(error);
          resolve(result?.secure_url);
        }
      );
      stream.end(file.buffer);
    });
  }
  
  // Fallback: filesystem
  const uniqueFilename = `${uuidv4()}.${ext}`;
  fs.writeFileSync(targetPath, file.buffer);
  return relPath;
};
```

## Testes Recomendados

### Teste Local
```bash
# Dev usa /static/uploads
curl -X POST http://localhost:5000/reader/profile/photo \
  -H "Authorization: Bearer TOKEN" \
  -F "imagem=@photo.jpg"
```

### Teste em Vercel
```bash
# Vercel usa Cloudinary (se configurado)
curl -X POST https://seu-projeto.vercel.app/api/reader/profile/photo \
  -H "Authorization: Bearer TOKEN" \
  -F "imagem=@photo.jpg"

# Response: { imagem_url: "https://res.cloudinary.com/..." }
```

## Arquivos Modificados

- ✅ `src/utils/image.ts` - Added Cloudinary support
- ✅ `src/controllers/reader.ts` - Added await
- ✅ `src/controllers/editor.ts` - Added await (2x)
- ✅ `src/index.ts` - Serverless detection + /tmp fallback
- ✅ `.env.example` - Cloudinary vars documented
- ✅ `package.json` - Added cloudinary dependency

## Próximos Passos

1. **Deploy**: `git push` para Vercel (auto-deploys)
2. **Verificar logs**: Vercel Dashboard → Deployments → Logs
3. **Testar**: Login + Upload foto em produção
4. **Monitorar**: Verificar URLs no banco de dados
