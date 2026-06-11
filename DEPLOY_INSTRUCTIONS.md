# 🚀 INSTRUÇÕES FINAIS DE DEPLOYMENT

## Status Atual ✅

Backend completamente corrigido com:
- ✅ Integração com Cloudinary
- ✅ Tratamento de URLs inteligente
- ✅ Migração automática de imagens
- ✅ Documentação completa

Commits pendentes para fazer push:
```
348f4f5 - docs: Portuguese README com checklist
7473432 - add: Deploy script
2cf391e - docs: Vercel/Cloudinary integration guide
```

## 📤 Fazer Push para Vercel (2 opções)

### OPÇÃO 1: Via Script (Recomendado) ⭐
```bash
cd ~/Documents/dev/backend-lumina-node
./deploy.sh
```

Ele:
1. Compila o código
2. Faz git push origin master
3. Mostra próximos passos

### OPÇÃO 2: Manual
```bash
cd ~/Documents/dev/backend-lumina-node
npm run build                      # Verifica erros
git push origin master             # Push para GitHub
```

**Quando pedir passphrase SSH:**
- Digite a passphrase diretamente no terminal (não será exibida)
- Pressione Enter

**Se falhar com passphrase:**
```bash
# Configure ssh-agent primeiro
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519

# Depois tente push novamente
git push origin master
```

## ✨ Após Push (Vercel Auto-Deploys)

1. **Vercel Rebuild** (~2-3 min)
   - GitHub recebe push
   - Vercel detecta automaticamente
   - Inicia novo build
   - Deploy ativado

2. **Configure Cloudinary em Vercel** (IMPORTANTE!)
   ```
   Vercel Dashboard → Seu Projeto → Settings → Environment Variables
   ```
   
   Adicione 3 variáveis:
   - `CLOUDINARY_CLOUD_NAME` = seu_cloud_name
   - `CLOUDINARY_API_KEY` = seu_api_key  
   - `CLOUDINARY_API_SECRET` = seu_api_secret
   
   (Crie conta gratuita em https://cloudinary.com se não tiver)

3. **Redeploy com Cloudinary**
   ```
   Vercel Dashboard → Deployments → Redeploy (botão)
   ```
   
   Ou:
   ```bash
   cd ~/Documents/dev/backend-lumina-node
   git commit --allow-empty -m "Trigger redeploy with Cloudinary"
   git push origin master
   ```

## 🧪 Testar em Produção

```bash
# Terminal 1: Emulador/Aparelho rodar app
flutter run

# Ou: Em VS Code
# - Abrir command palette: Cmd+Shift+P
# - "Flutter: Select Device"
# - Selecionar dispositivo
# - "Debug: Start Debugging" (F5)
```

No app:
1. Logout se tiver sessão anterior
2. Login com credenciais
3. Ir em "Minha Conta"
4. Clicar no avatar/foto
5. Dialog abre: "Editar Perfil"
6. Botões: "📷 Câmera" ou "🖼️ Galeria"
7. Selecionar foto
8. Botão "Salvar"
9. ✅ Deve fazer upload com sucesso

Se vir URL do Cloudinary em Vercel logs → funcionou!

## 📋 Checklist Final

Antes de testar mobile:
- [ ] Code foi feito push com git
- [ ] Vercel terminou build (status "Ready")
- [ ] Cloudinary vars adicionadas em Vercel
- [ ] Redeploy feito em Vercel
- [ ] Logs em Vercel não mostram erro

Ao testar no mobile:
- [ ] App conecta à API (sem erro de conexão)
- [ ] Login/logout funciona
- [ ] Edit profile abre dialog
- [ ] Camera picker funciona
- [ ] Gallery picker funciona
- [ ] Upload sem erro 404
- [ ] Imagem aparece no perfil

## 🔍 Logs para Verificar

**Vercel Logs** (vercel.com → Project → Deployments → Logs)
- Procure por: `Cloudinary`, `migration`, `upload`
- Deve mostrar: `✓ Image uploaded to Cloudinary: https://...`

**Mobile Logs** (flutter run)
- Procure por erro HTTP 404
- Deve reconhecer URLs de Cloudinary

## ❓ Dúvidas Frequentes

**P: Por quanto tempo leva o redeploy?**
R: 1-2 minutos normalmente

**P: Preciso fazer algo na aplicação Flutter?**
R: Não! Mudanças são no backend. App já está configurado

**P: As imagens antigas vão desaparecer?**
R: No primeiro deploy sim (ephemeral). Mas são migradas automaticamente para Cloudinary em seguida

**P: Como saber se funcionou?**
R: Verificar Vercel logs por "Image uploaded to Cloudinary"

---

## 🎯 Resumo em 3 Passos

```bash
1️⃣ git push origin master              # Push código
2️⃣ Adicionar Cloudinary vars em Vercel # Config
3️⃣ Redeploy em Vercel                  # Deploy
```

Depois disso: testar no mobile!

---

**Documentação**: Ver [README_VERCEL_FIX.md](README_VERCEL_FIX.md) para detalhes técnicos
**Script de Deploy**: `./deploy.sh` facilita o processo

**Status**: ✅ PRONTO PARA DEPLOY
