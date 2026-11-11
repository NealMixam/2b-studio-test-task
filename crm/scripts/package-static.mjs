import { cpSync, mkdirSync } from 'node:fs'
mkdirSync('dist', { recursive: true })
cpSync('crm/dist', 'dist', { recursive: true })
console.log('Static build copied to dist/')
