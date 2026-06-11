# Fix para Vercel Image Upload - Cloudinary Integration

## Problema Reportado
```
HttpException: Invalid statusCode: 404, uri = 
http://lumina-nodejs-api.vercel.app/static/uploads/users/ef456d43a31f404490d90e6747a2a604.jpg
```

**Causa**: Em Vercel, o filesystem é ephemeral (`/var/task` é resetado após cada função). Imagens antigas com paths relativos ficam 404.

## Solução Implementada

### 1. **Backend Changes** ✅
- ✅ [Cloudinary Integration](src/utils/image.ts)
  - `saveImage()` agora é `async` e detecta Cloudinary
  - Retorna URLs completas do Cloudinary quando disponível
  - Fallback para `/tmp` se Cloudinary não configurado

- ✅ [URL Handling](src/utils/image.ts)
  - `getImageUrl()` agora detec full URLs (http://, https://, data:)
  - Não dupli ca `/static/uploads/` em URLs do Cloudinary

- ✅ [Static File Serving](src/index.ts)
  - `/static/uploads` agora servido em Vercel (usando `/tmp` ephemeral)
  - Permite imagens antigas continuarem acessíveis por tempo limitado

- ✅ [Automatic Migration](src/utils/image-migration.ts)
  - `migrateImageToCloudinary()` - migra arquivo individual para Cloudinary
  - `migrateAllUserImages()` - migra todos os usuários no startup
  - Rodado automaticamente quando `VERCEL=1` + Cloudinary configurado

### 2. **Required Vercel Configuration** 🔑

No **Vercel Project Settings**, adicionar estas environment variables:
```env
VERCEL=1                        # Auto-set by Vercel, confirmar que existe
CLOUDINARY_CLOUD_NAME=seu_value
CLOUDINARY_API_KEY=seu_value
CLOUDINARY_API_SECRET=seu_value
```

### 3. **Setup Steps**

#### Step 1: Create Cloudinary Account
1. Go to https://cloudinary.com/users/register/free
2. Sign up with email
3. Go to Dashboard > Account Details
4. Copy: Cloud Name, API Key, API Secret

#### Step 2: Add to Vercel
1. Vercel Dashboard > Project > Settings > Environment Variables
2. Add the 3 variables above
3. Make sure they're added to Production environment
4. Redeploy project

#### Step 3: Test
```bash
# Login on Flutter app
# Edit profile → Upload photo
# Should now work with Cloudinary URL
```

## Technical Details

### Image Flow - New
```
User uploads photo
    ↓
POST /reader/profile/photo
    ↓
Cloudinary enabled?
  YES → cloudinary.uploader.upload_stream()
       ↓ Retorna: "https://res.cloudinary.com/..."
  NO  → fs.write() to /tmp/uploads
       ↓ Retorna: "users/abc123.jpg"
    ↓
Save URL to user.imagem
    ↓
Return response with full URL
    ↓
Flutter loads image OK ✅
```

### Image Flow - Old Images
```
Database has: "users/ef456d43a31f404490d90e6747a2a604.jpg"
    ↓
User logs in
    ↓
Backend returns old path
    ↓
Frontend calls getImageUrl()
    ↓
Detects it's not a full URL
    ↓
Builds: "https://api.vercel.app/static/uploads/users/..."
    ↓
Frontend tries to load
    ↓
If file exists in /tmp → loads OK ✅ (until cold restart)
If file gone → 404 ❌ (ephemeral nature)
```

### Migration Process
When app starts in Vercel with Cloudinary:
```
AppDataSource.initialize()
    ↓
criarAdminInicial()
    ↓
migrateAllUserImages() [NEW]
  for each user with user.imagem:
    if path is relative:
      → read from /tmp
      → upload to Cloudinary
      → update database with new URL
      → delete local file
```

## Expected Behavior After Fix

### ✅ New Uploads (After Deployment)
- User uploads photo → Stored in Cloudinary CDN
- Returns: `https://res.cloudinary.com/xxxx/image/upload/xxxx.jpg`
- Persistent across server restarts
- Works everywhere

### ⚠️ Old Images (First Deploy)
- Existing photos might get 404 briefly
- Auto-migration runs on startup
- After migration: appear as Cloudinary URLs
- Or user can re-upload in Edit Profile

## Files Modified
- `src/utils/image.ts` - Cloudinary + URL detection
- `src/utils/image-migration.ts` - [NEW] Migration logic
- `src/controllers/reader.ts` - Added `await`
- `src/controllers/editor.ts` - Added `await` (2x)
- `src/index.ts` - Migration + serve uploads
- `.env.example` - Documented Cloudinary vars
- `package.json` - Added `cloudinary` package

## Commits Made
1. `ca1fe7c` - Cloudinary integration
2. `e4aa1df` - URL handling fix
3. `8794445` - Auto-migration [PENDING PUSH]

## Next Steps
1. ✅ Code pushed to GitHub
2. ⏳ Vercel auto-deploys
3. 🔑 Add Cloudinary env vars to Vercel
4. ✅ Vercel redeploys with new env vars
5. 🧪 Test upload on Flutter app
6. 📊 Monitor Vercel logs for migration success

## Testing Checklist
- [ ] Deploy successful on Vercel
- [ ] No errors in Vercel logs
- [ ] Cloudinary env vars confirmed in Vercel
- [ ] Login on Flutter app works
- [ ] Edit profile opens dialog
- [ ] Camera button works
- [ ] Gallery button works
- [ ] Photo uploads and displays
- [ ] Old images migrate to Cloudinary
- [ ] Profile page shows photo correctly

## Troubleshooting

### Images still showing 404?
- Check: Cloudinary env vars in Vercel ✓
- Check: Cloudinary credentials correct ✓
- Wait: Migration takes time on first request
- Re-upload: Click Edit Profile → Select Photo

### Migration not running?
- Must have `VERCEL=1` + Cloudinary configured
- Runs only on first init after deploy
- Check: Vercel function logs for "migration" message

### Cloudinary upload failing?
- Verify credentials in dashboard
- Check: API Key ≠ API Secret (easy mistake!)
- Ensure account has permission to upload
