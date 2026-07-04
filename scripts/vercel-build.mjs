// Build do Vercel: tenta aplicar as migrations no Supabase (se as credenciais
// estiverem configuradas) e SEMPRE builda o frontend. As migrations são
// "best-effort": com timeout e sem bloquear o deploy — se falharem, o site sobe
// mesmo assim e você aplica as migrations à parte (`npx supabase db push`).
//
// Variáveis (Vercel → Project Settings → Environment Variables) para as
// migrations rodarem automaticamente:
//   SUPABASE_PROJECT_REF   → ref do projeto (Project Settings → General)
//   SUPABASE_ACCESS_TOKEN  → token pessoal — https://supabase.com/dashboard/account/tokens
//   SUPABASE_DB_PASSWORD   → senha do banco (definida ao criar o projeto)
import { execSync } from 'node:child_process'

const { SUPABASE_PROJECT_REF: ref, SUPABASE_ACCESS_TOKEN: token, SUPABASE_DB_PASSWORD: dbpw } = process.env
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', env: process.env, ...opts })
const CLI = 'npx --yes supabase@1.200.3'

if (ref && token && dbpw) {
  console.log('› Supabase: aplicando migrations (db push)…')
  try {
    run(`${CLI} link --project-ref ${ref} -p "${dbpw}"`, { timeout: 120_000 })
    run(`${CLI} db push -p "${dbpw}"`, { timeout: 180_000 })
    console.log('✓ Supabase: migrations aplicadas.')
  } catch (e) {
    console.warn('⚠ Não foi possível aplicar as migrations no build — o site vai subir mesmo assim.')
    console.warn(`  Aplique manualmente:  npx supabase link --project-ref ${ref} && npx supabase db push`)
    console.warn('  Detalhe:', e?.message ?? e)
  }
} else {
  console.log('› Supabase: SUPABASE_PROJECT_REF/ACCESS_TOKEN/DB_PASSWORD ausentes — pulando migrations (só frontend).')
}

run('npm run build')
