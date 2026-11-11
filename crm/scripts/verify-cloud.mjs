import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
const accounts = JSON.parse(await readFile(new URL('../../.tmp/demo-access.json', import.meta.url), 'utf8'))
const url = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Нужен --env-file=crm/.env.local')
const clients = []
for (const a of accounts) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInWithPassword({ email: a.email, password: a.password })
  if (error) throw new Error(`Вход ${a.role}: ${error.message}`)
  clients.push(client)
}
const [manager, worker, other] = clients
async function call(client, name, args) {
  const result = await client.rpc(name, args)
  if (result.error) throw new Error(`${name}: ${result.error.message}`)
  return result.data
}
async function read(client, table) {
  const result = await client.from(table).select('*')
  if (result.error) throw new Error(`${table}: ${result.error.message}`)
  return result.data
}
let tempObject
try {
  const settings = await fetch(url + '/auth/v1/settings', { headers: { apikey: key } }).then(r => r.json())
  assert.equal(settings.disable_signup, true, 'Открытая регистрация должна быть отключена')
  console.log('PASS: 3 входа email/password; открытая регистрация отключена')
  const objects = await read(manager, 'objects'), tasks = await read(manager, 'tasks')
  assert.ok(objects.length >= 3); assert.ok(tasks.length >= 6)
  assert.equal(new Set(tasks.map(t => t.status)).size, 5)
  for (let i = 1; i <= 2; i++) {
    const ownTasks = await read(clients[i], 'tasks'), ownObjects = await read(clients[i], 'objects'), history = await read(clients[i], 'task_history')
    assert.ok(ownTasks.length > 0)
    assert.ok(ownTasks.every(t => t.assignee_id === accounts[i].id))
    assert.ok(ownObjects.every(o => ownTasks.some(t => t.object_id === o.id)))
    assert.ok(history.every(h => ownTasks.some(t => t.id === h.task_id)))
    // Same queries used by UI; exercises the profiles policy through tasks/history.
    assert.ok((await read(clients[i], 'profiles')).some(p => p.id === accounts[0].id))
  }
  console.log('PASS: 3 объекта, 6 задач, 5 статусов; RLS задач, объектов, истории и профилей')
  tempObject = await call(manager, 'save_object', { p_name: 'Временный объект автоматической проверки', p_address: 'Тестовые данные' })
  const id = await call(manager, 'save_task', { p_title: 'Проверка API', p_description: 'Удаляется после проверки', p_object_id: tempObject, p_assignee_id: accounts[1].id })
  assert.ok((await other.rpc('change_task_status', { p_id: id, p_expected_status: 'new', p_status: 'in_progress' })).error)
  assert.ok((await worker.rpc('change_task_status', { p_id: id, p_expected_status: 'new', p_status: 'accepted' })).error)
  for (const client of [manager, worker]) {
    assert.ok((await client.from('tasks').update({ status: 'accepted' }).eq('id', id)).error)
    assert.ok((await client.from('profiles').update({ role: 'manager' }).eq('id', accounts[1].id)).error)
    assert.ok((await client.from('task_history').insert({ task_id: id, actor_id: accounts[0].id, to_status: 'accepted' })).error)
    assert.ok((await client.from('task_history').delete().eq('task_id', id)).error)
  }
  console.log('PASS: прямые записи, повышение роли, подделка истории и чужой RPC запрещены')
  const change = (client, from, to, comment = null) => call(client, 'change_task_status', { p_id: id, p_expected_status: from, p_status: to, p_comment: comment })
  await assert.rejects(change(worker, null, 'in_progress'))
  await change(worker, 'new', 'in_progress')
  await assert.rejects(change(worker, 'new', 'in_progress'))
  await change(worker, 'in_progress', 'review')
  await assert.rejects(change(manager, 'review', 'rework', '  '))
  await assert.rejects(change(manager, 'review', 'rework', '\t\n\r'))
  await change(manager, 'review', 'rework', 'Исправить замечания')
  await change(worker, 'rework', 'in_progress')
  await change(worker, 'in_progress', 'review')
  await change(manager, 'review', 'accepted')
  const history = (await read(worker, 'task_history')).filter(h => h.task_id === id)
  assert.equal(history.length, 7)
  assert.equal(history.filter(h => h.comment === 'Исправить замечания').length, 1)
  console.log('PASS: полный цикл через облачный API, обязательный комментарий, 7 записей истории')
} finally {
  if (tempObject) await call(manager, 'delete_object', { p_id: tempObject })
  await Promise.all(clients.map(c => c.auth.signOut({ scope: 'local' })))
}
console.log('Облачные проверки завершены. Временные данные удалены.')

