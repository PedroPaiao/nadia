// Build do Vercel: aplica as migrations no Supabase (se as credenciais estiverem
// configuradas) e depois builda o frontend. É seguro — se as variáveis do Supabase
// não estiverem definidas, apenas builda o site (ex.: previews).
//
// Variáveis necessárias no Vercel (Project Settings → Environment Variables) para
// as migrations rodarem automaticamente no deploy:
//   SUPABASE_PROJECT_REF   → ref do projeto (ex.: abcdxyz...) — em Supabase → Project Settings → General
//   SUPABASE_ACCESS_TOKEN  → token pessoal — https://supabase.com/dashboard/account/tokens
//   SUPABASE_DB_PASSWORD   → senha do banco (a que você definiu ao criar o projeto)
import { execSync } from 'node:child_process'

const { SUPABASE_PROJECT_REF: ref, SUPABASE_ACCESS_TOKEN: token, SUPABASE_DB_PASSWORD: dbpw } = process.env
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env: process.env })

if (ref && token && dbpw) {
  console.log('› Supabase: aplicando migrations (db push)…')
  try {
    run(`npx --yes supabase@1.200.3 link --project-ref ${ref} -p "${dbpw}"`)
    run(`npx --yes supabase@1.200.3 db push -p "${dbpw}"`)
    console.log('› Supabase: migrations aplicadas.')
  } catch (e) {
    console.error('✗ Falha ao aplicar migrations no Supabase.')
    throw e
  }
} else {
  console.log('› Supabase: SUPABASE_PROJECT_REF/ACCESS_TOKEN/DB_PASSWORD ausentes — pulando migrations (só build do frontend).')
}

run('npm run build')
