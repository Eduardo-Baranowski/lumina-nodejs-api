#!/bin/bash

# Script para testar as rotas de perfil da API

BASE_URL="http://localhost:5000"
TEST_USER_EMAIL="teste-profile-$(date +%s)@example.com"
TEST_USER_NOME="Teste User $(date +%s)"
TEST_USER_SENHA="teste123"

echo "✏️ 0. Registrando novo usuário de teste..."
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"nome\":\"$TEST_USER_NOME\",\"email\":\"$TEST_USER_EMAIL\",\"senha\":\"$TEST_USER_SENHA\"}")

echo "Resposta:"
echo "$REGISTER_RESPONSE" | jq '.'

echo ""
echo "🔐 1. Fazendo login..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_USER_EMAIL\",\"senha\":\"$TEST_USER_SENHA\"}")

echo "Resposta do login:"
echo "$LOGIN_RESPONSE" | jq '.'

TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token_sessao // empty')

if [ -z "$TOKEN" ]; then
  echo "❌ Erro: Não foi possível obter o token"
  exit 1
fi

echo ""
echo "✅ Token obtido: ${TOKEN:0:50}..."

echo ""
echo "📝 2. Testando PUT /reader/profile (atualizar nome)..."
PROFILE_RESPONSE=$(curl -s -X PUT "$BASE_URL/reader/profile" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nome":"João Silva Atualizado","headline":"Leitor entusiasmado"}')

echo "Resposta:"
echo "$PROFILE_RESPONSE" | jq '.'

echo ""
echo "📸 3. Testando POST /reader/profile/photo (upload de foto)..."

# Criar uma imagem de teste simples (PNG 1x1)
TEMP_IMG="/tmp/test_profile.png"
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\r\xb3\x00\x00\x00\x00IEND\xaeB`\x82' > "$TEMP_IMG"

PHOTO_RESPONSE=$(curl -s -X POST "$BASE_URL/reader/profile/photo" \
  -H "Authorization: Bearer $TOKEN" \
  -F "imagem=@$TEMP_IMG")

echo "Resposta:"
echo "$PHOTO_RESPONSE" | jq '.'

echo ""
echo "✅ Testes completados!"
