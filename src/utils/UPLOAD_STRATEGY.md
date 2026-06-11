/**
 * Solução para upload de imagens em produção (Vercel)
 * 
 * ⚠️ IMPORTANTE: O filesystem em Vercel é efêmero (/tmp desaparece após execução)
 * 
 * Opções de solução:
 * 
 * 1. CLOUDINARY (Recomendado - fácil de implementar)
 *    - Criar conta gratuita em https://cloudinary.com
 *    - Adicionar variáveis de ambiente:
 *      CLOUDINARY_CLOUD_NAME=seu_cloud_name
 *      CLOUDINARY_API_KEY=sua_api_key
 *      CLOUDINARY_API_SECRET=seu_api_secret
 *    - Usar npm package 'cloudinary'
 * 
 * 2. SUPABASE STORAGE (Já usam Supabase para BD)
 *    - Usar @supabase/supabase-js com upload de arquivos
 *    - Manter tudo em um lugar
 * 
 * 3. AWS S3
 *    - Para projetos maiores
 *    - Usar aws-sdk
 * 
 * SOLUÇÃO TEMPORÁRIA (atual):
 * - Armazena URL placeholder no banco
 * - Funciona localmente com /static/uploads
 * - Em Vercel, arquivos serão perdidos após requisição
 * 
 * TODO:
 * [ ] Implementar integração com Cloudinary
 * [ ] Atualizar reader.ts para usar Cloudinary
 * [ ] Adicionar testes para upload em produção
 */

// Exemplo de integração com Cloudinary (NÃO IMPLEMENTADO AINDA):

/*
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadToCloudinary(file: Express.Multer.File, folder: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error) reject(error);
        if (result) resolve(result.secure_url);
      }
    );
    stream.end(file.buffer);
  });
}
*/
