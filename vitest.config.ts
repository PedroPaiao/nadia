import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Config separada da vite.config.ts para não acoplar o build de produção ao vitest.
// Testes de banco compartilham UM Postgres local, então rodam SERIALMENTE (um processo,
// um arquivo por vez) para serem 100% determinísticos — cada teste se isola via
// transação + rollback (ver tests/helpers/db.ts).
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
