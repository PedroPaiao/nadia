// ============================================================================
// Exporta TODAS as coleções do Firestore para JSON — rode LOCALMENTE (na sua máquina).
// As credenciais do Firebase NÃO saem do seu PC. Depois me mande só os arquivos JSON.
//
// Passos:
//   1) Firebase Console → Configurações do projeto → Contas de serviço →
//      "Gerar nova chave privada" → salve como  serviceAccount.json  NESTA pasta raiz.
//      (o .gitignore já ignora esse arquivo — nunca será commitado)
//   2) npm i firebase-admin
//   3) node scripts/firebase-export.mjs
//   4) Me mande os arquivos gerados em  ./firebase-export/*.json
//   5) Depois, REVOGUE essa chave no Console (Contas de serviço) — já cumpriu o papel.
// ============================================================================
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'

const sa = JSON.parse(readFileSync('./serviceAccount.json', 'utf8'))
initializeApp({ credential: cert(sa) })
const db = getFirestore()

mkdirSync('./firebase-export', { recursive: true })

// Descobre automaticamente todas as coleções da raiz.
const colecoes = await db.listCollections()
console.log('Coleções encontradas:', colecoes.map((c) => c.id).join(', ') || '(nenhuma)')

for (const c of colecoes) {
  const snap = await c.get()
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  writeFileSync(`./firebase-export/${c.id}.json`, JSON.stringify(docs, null, 2))
  console.log(`  ${c.id}: ${docs.length} documento(s)`)
}

console.log('\nPronto! Veja a pasta ./firebase-export/ e me envie os .json (NÃO envie o serviceAccount.json).')
