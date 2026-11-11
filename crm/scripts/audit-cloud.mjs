import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
const nativeFetch = globalThis.fetch
globalThis.fetch = (input, init = {}) => nativeFetch(input, { ...init, signal: init.signal || AbortSignal.timeout(15000) })
const url = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const accounts=JSON.parse(await readFile(new URL('../../.tmp/demo-access.json',import.meta.url),'utf8'))
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
async function request(path,token,extra={}) {
  const r=await fetch(url+path,{headers:{apikey:key,...(token?{Authorization:`Bearer ${token}`} : {}),...extra}})
  return {status:r.status,text:await r.text()}
}
for (const table of ['objects','tasks','profiles','task_history']) {
  const r=await request('/rest/v1/'+table+'?select=*')
  assert.ok([401,403].includes(r.status), `Anon ${table}: ${r.status}`)
}
console.log('PASS: анонимное чтение всех четырёх таблиц запрещено')
const {data,error}=await client.auth.signInWithPassword({email:accounts[0].email,password:accounts[0].password})
assert.equal(error,null)
try {
  const token=data.session.access_token
  const admin=await request('/auth/v1/admin/users',token)
  assert.equal(admin.status,403,'Постановщик CRM не должен управлять Supabase Auth')
  const hidden=await request('/rest/v1/users?select=*',token,{'Accept-Profile':'auth'})
  assert.equal(hidden.status,406,'Схема auth не должна быть доступна в Data API')
  const pieces=token.split('.')
  const payload=JSON.parse(Buffer.from(pieces[1],'base64url'))
  payload.role='service_role'
  pieces[1]=Buffer.from(JSON.stringify(payload)).toString('base64url')
  assert.equal((await request('/rest/v1/tasks?select=*',pieces.join('.'))).status,401)
  for (const name of ['guard_task_status','audit_task_status']) {
    const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'})
    assert.ok([401,403,404].includes(r.status), `${name}: ${r.status}`)
  }
  console.log('PASS: Auth Admin API, схема auth, поддельный JWT и служебные функции недоступны')
} finally { await client.auth.signOut({scope:'local'}) }
const site='https://kontur-objects-tasks-nealmixam.downycloud.chatgpt.site'
const htmlResponse=await fetch(site)
assert.equal(htmlResponse.status,200)
const html=await htmlResponse.text()
assert.ok(html.includes('Контур'))
const asset=html.match(/src="([^"]+\.js)"/)
assert.ok(asset,'Не найден скрипт сборки')
const js=await fetch(new URL(asset[1],site)).then(r=>r.text())
assert.ok(js.includes(url),'Production должен подключаться к предоставленному проекту')
assert.ok(js.includes(key),'Публичный ключ должен быть в production')
for(const body of [html,js]) {
  assert.ok(!accounts.some(a=>body.includes(a.password)))
  assert.ok(!/(sb_secret_|sbp_)[a-zA-Z0-9_-]{20,}/.test(body))
}
for(const path of ['/.env.local','/.tmp/demo-access.json','/crm/.env.local']) {
  const r=await fetch(site+path), body=await r.text()
  assert.ok(!accounts.some(a=>body.includes(a.password)))
  assert.ok(!body.includes('VITE_SUPABASE_PUBLISHABLE_KEY='))
  assert.ok([200,404].includes(r.status))
}
console.log('PASS: опубликованный сайт HTTP 200, верный Supabase, пароли и env-файлы не публикуются')
console.log('Заголовки:', JSON.stringify({csp:htmlResponse.headers.has('content-security-policy'),frame:htmlResponse.headers.get('x-frame-options'),hsts:htmlResponse.headers.has('strict-transport-security')}))

