import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
const manager = '10000000-0000-0000-0000-000000000001', worker = '10000000-0000-0000-0000-000000000002', other = '10000000-0000-0000-0000-000000000003', manager2 = '10000000-0000-0000-0000-000000000004'
let site, hidden, task, foreign
async function as(id, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`)
  try { return await fn() } finally { await db.exec('reset role') }
}
async function scalar(sql, params = []) { return (await db.query(sql, params)).rows[0].value }
async function createTask(assignee = worker, object = site) {
  return as(manager, () => scalar(`select public.save_task('Проверить перекрытия','Описание',$1,$2) as value`, [object, assignee]))
}
async function transition(id, from, to, who, comment = null) {
  return as(who, () => db.query('select public.change_task_status($1,$2,$3,$4)', [id, from, to, comment]))
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$; grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`)
  const migrations = new URL('../supabase/migrations/', import.meta.url)
  for (const file of (await readdir(migrations)).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, migrations), 'utf8'))
  for (const [id, role, name] of [[manager, 'manager', 'Руководитель'], [worker, 'worker', 'Исполнитель 1'], [other, 'worker', 'Исполнитель 2'], [manager2, 'manager', 'Руководитель 2']]) {
    await db.query('insert into auth.users values ($1)', [id])
    await db.query('insert into public.profiles values ($1,$2,$3)', [id, name, role])
  }
  site = await as(manager, () => scalar("select public.save_object('ЖК Северный','Москва') as value"))
  hidden = await as(manager2, () => scalar("select public.save_object('Склад','Казань') as value"))
  task = await createTask()
  foreign = await createTask(other, hidden)
})
after(() => db.close())
test('RLS: исполнитель видит только свои задачи, связанные объекты и историю', async () => {
  await as(worker, async () => {
    assert.deepEqual((await db.query('select id from tasks')).rows.map(r => r.id), [task])
    assert.deepEqual((await db.query('select id from objects')).rows.map(r => r.id), [site])
    assert.equal((await db.query('select * from task_history')).rows.length, 1)
    assert.equal((await db.query('select * from profiles where id = $1', [other])).rows.length, 0)
  })
  await as(manager2, async () => { assert.equal((await db.query('select * from tasks')).rows.length, 2) })
})
test('Прямые INSERT/UPDATE/DELETE и повышение роли через API запрещены обеим ролям', async () => {
  for (const id of [worker, manager]) await as(id, async () => {
    for (const sql of ["update tasks set status='accepted'", "delete from tasks", "insert into objects(name,address) values ('X','Y')", "update profiles set role='manager'", "insert into task_history(task_id,actor_id,to_status) values ('" + task + "','" + id + "','accepted')", "update task_history set comment='Подделка'", "delete from task_history"]) await assert.rejects(db.exec(sql), /permission denied/)
  })
})
test('Исполнитель не может изменять данные или чужие статусы через RPC', async () => {
  await as(worker, async () => {
    await assert.rejects(db.query("select save_object('x','y')"), /постановщик/)
    await assert.rejects(db.query('select delete_object($1)', [site]), /прав/)
    await assert.rejects(db.query('select delete_task($1)', [task]), /прав/)
    await assert.rejects(db.query("select save_task('x','y',$1,$2,$3)", [site, worker, task]), /постановщик/)
  })
  await assert.rejects(transition(foreign, 'new', 'in_progress', worker), /недоступна/)
})
test('Полный цикл, обязательный комментарий, неизменяемая история и авторство', async () => {
  const id = await createTask()
  await transition(id, 'new', 'in_progress', worker)
  await transition(id, 'in_progress', 'review', worker)
  for (const comment of [null, '', '   ']) await assert.rejects(transition(id, 'review', 'rework', manager, comment), /комментарий/)
  assert.equal(await scalar('select count(*)::int as value from task_history where task_id=$1', [id]), 3)
  await transition(id, 'review', 'rework', manager2, 'Исправить стыки')
  await transition(id, 'rework', 'in_progress', worker)
  await transition(id, 'in_progress', 'review', worker)
  await transition(id, 'review', 'accepted', manager)
  const history = (await db.query('select * from task_history where task_id=$1 order by id', [id])).rows
  assert.equal(history.length, 7)
  assert.equal(history[0].from_status, null)
  assert.equal(history[3].comment, 'Исправить стыки')
  assert.equal(history[3].actor_id, manager2)
  assert.ok(history.every(h => h.created_at))
  await assert.rejects(transition(id, 'accepted', 'in_progress', worker), /запрещён/)
})
test('Матрица: все 25 пар статусов проверены для двух ролей', async () => {
  const states = ['new','in_progress','review','accepted','rework']
  for (const who of [worker, manager]) for (const from of states) for (const to of states) {
    const id = await createTask()
    // Prepare isolated fixtures as database owner; never available through the API.
    await db.exec('alter table tasks disable trigger guard_task_status; alter table tasks disable trigger audit_task_status;')
    await db.query('update tasks set status=$1 where id=$2', [from, id])
    await db.exec('alter table tasks enable trigger guard_task_status; alter table tasks enable trigger audit_task_status;')
    const allowed = who === manager ? from === 'review' && ['accepted','rework'].includes(to) : (['new','rework'].includes(from) && to === 'in_progress') || (from === 'in_progress' && to === 'review')
    if (allowed) await transition(id, from, to, who, 'Комментарий')
    else await assert.rejects(transition(id, from, to, who, 'Комментарий'))
  }
})
test('Устаревший статус отклонён, повторный запрос не дублирует историю', async () => {
  const id = await createTask()
  await transition(id, 'new', 'in_progress', worker)
  await assert.rejects(transition(id, 'new', 'in_progress', worker), /уже изменена/)
  assert.equal(await scalar('select count(*)::int as value from task_history where task_id=$1', [id]), 2)
})
test('CRUD постановщика: валидация, переназначение, перенос и каскадное удаление', async () => {
  const id = await createTask()
  await as(manager, async () => {
    await assert.rejects(db.query("select save_task('x','',$1,$2)", [site, manager]), /только исполнителя/)
    await assert.rejects(db.query("select save_object('  ','Адрес')"), /check constraint/)
    await db.query("select save_task('Изменено','Новое описание',$1,$2,$3)", [hidden, other, id])
  })
  await as(worker, async () => assert.equal((await db.query('select * from tasks where id=$1', [id])).rows.length, 0))
  await as(other, async () => assert.equal((await db.query('select * from tasks where id=$1', [id])).rows[0].title, 'Изменено'))
  await as(manager2, () => db.query('select delete_task($1)', [id]))
  assert.equal(await scalar('select count(*)::int as value from task_history where task_id=$1', [id]), 0)
  const object = await as(manager, () => scalar("select save_object('Удаляемый','Адрес') as value"))
  const child = await createTask(worker, object)
  await as(manager, () => db.query('select delete_object($1)', [object]))
  assert.equal(await scalar('select count(*)::int as value from tasks where id=$1', [child]), 0)
})
test('Анонимный доступ к таблицам и функциям закрыт', async () => {
  await db.exec('set role anon')
  try {
    await assert.rejects(db.exec('select * from tasks'), /permission denied/)
    await assert.rejects(db.exec("select save_object('x','y')"), /permission denied/)
  } finally { await db.exec('reset role') }
})

test('Комментарий из табуляций и переносов строк не позволяет вернуть задачу', async () => {
  const id = await createTask()
  await transition(id, 'new', 'in_progress', worker)
  await transition(id, 'in_progress', 'review', worker)
  await assert.rejects(transition(id, 'review', 'rework', manager, '\t\n\r'), /комментарий/)
})
test('NULL вместо ожидаемого статуса не обходит защиту от устаревшего запроса', async () => {
  const id = await createTask()
  await assert.rejects(transition(id, null, 'in_progress', worker), /статус|изменена/)
})

