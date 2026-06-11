#!/bin/bash
# Deploy script para Vercel com Cloudinary

set -e

cd "$(dirname "$0")"

echo "🚀 Backend Deploy para Vercel"
echo "======================================"

# Verificar branch
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "master" ]; then
  echo "❌ Você está na branch '$BRANCH'. Mude para 'master':"
  echo "   git checkout master"
  exit 1
fi

# Verificar commits pendentes
PENDING=$(git log origin/master..master | wc -l)
if [ "$PENDING" -eq 0 ]; then
  echo "✅ Tudo está sincronizado com GitHub"
  exit 0
fi

echo "📦 Commits pendentes: $PENDING"

# Compilar
echo "🔨 Compilando..."
npm run build || exit 1
echo "✅ Build OK"

# Git push
echo "🌐 Fazendo push para GitHub..."
git push origin master || {
  echo "❌ Push falhou. Digite a passphrase SSH quando solicitado."
  echo "   Se tiver problema, configure ssh-agent:"
  echo "   eval \"\$(ssh-agent -s)\""
  echo "   ssh-add ~/.ssh/id_ed25519"
  exit 1
}

echo ""
echo "✅ DEPLOY INICIADO!"
echo "======================================"
echo ""
echo "📋 Próximos passos:"
echo ""
echo "1️⃣  Vercel detectará a mudança e começará a reconstruir"
echo ""
echo "2️⃣  Configure Cloudinary em Vercel:"
echo "    - Painel: https://vercel.com"
echo "    - Seu projeto → Settings → Environment Variables"
echo "    - Adicione:"
echo "      VERCEL=1 (auto-set, confirmar)"
echo "      CLOUDINARY_CLOUD_NAME=seu_valor"
echo "      CLOUDINARY_API_KEY=seu_valor"
echo "      CLOUDINARY_API_SECRET=seu_valor"
echo ""
echo "3️⃣  Redeploy com as variáveis:"
echo "    - Botão 'Redeploy' ou push vazio:"
echo "    git commit --allow-empty -m 'Trigger redeploy with Cloudinary'"
echo "    git push origin master"
echo ""
echo "4️⃣  Teste no app mobile:"
echo "    - Fazer login"
echo "    - Ir em Minha Conta"
echo "    - Clicar no avatar para editar"
echo "    - Tirar foto ou selecionar galeria"
echo "    - Deve aparecer com sucesso"
echo ""
echo "📊 Monitorar logs:"
echo "    Vercel → Deployments → Logs"
echo "    Procurar por: 'migration' ou 'Cloudinary'"
echo ""
