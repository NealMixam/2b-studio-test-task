import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Building2, CheckCheck, ArrowUpRight, Plus, Search, MapPin, LogOut, ArrowLeft, Pencil, Trash2, X, RefreshCw, ShieldCheck, HardHat } from 'lucide-react'
import { supabase, rows, rpc } from './api'
import { actions, statuses, type Profile, type SiteObject, type Task, type History, type Status } from './domain'

type Data = { profiles: Profile[]; objects: SiteObject[]; tasks: Task[]; history: History[] }
type Modal = { kind: 'object'; item?: SiteObject } | { kind: 'task'; item?: Task; objectId?: string } | { kind: 'status'; task: Task; status: Status } | { kind: 'delete'; entity: 'object' | 'task'; id: string; name: string }
const blank: Data = { profiles: [], objects: [], tasks: [], history: [] }
const date = (value: string) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const message = (e: unknown) => e instanceof Error ? e.message : (e as { message?: string })?.message || 'Не удалось выполнить запрос. Попробуйте ещё раз.'
const go = (path: string) => { window.location.hash = path }
function Badge({ status }: { status: Status }) { return <span className={`badge ${status}`}><i />{statuses[status]}</span> }
function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="empty"><Building2 size={32} /><h3>{title}</h3><p>{children}</p></div> }

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [data, setData] = useState<Data>(blank)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [route, setRoute] = useState(location.hash.slice(1) || '/objects')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState<Modal | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const profile = data.profiles.find(p => p.id === session?.user.id)
  const manager = profile?.role === 'manager'
  useEffect(() => {
    const handler = () => { setRoute(location.hash.slice(1) || '/objects'); setQuery(''); setFilter('all'); setModal(null) }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data, error }) => { if (error) setError(message(error)); setSession(data.session); setAuthReady(true) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setAuthReady(true) })
    return () => { listener.subscription.unsubscribe() }
  }, [])
  const refresh = useCallback(async () => {
    const current = ++generation.current
    if (!session) { setData(blank); return }
    setLoading(true); setError('')
    try {
      const [profiles, objects, tasks, history] = await Promise.all([rows<Profile>('profiles'), rows<SiteObject>('objects'), rows<Task>('tasks'), rows<History>('task_history')])
      if (current === generation.current) setData({ profiles, objects, tasks, history })
    } catch (e) { if (current === generation.current) setError(message(e)) }
    finally { if (current === generation.current) setLoading(false) }
  }, [session?.user.id])
  useEffect(() => { setData(blank); void refresh(); return () => { generation.current++ } }, [refresh])
  const person = (id: string) => data.profiles.find(p => p.id === id)?.full_name || 'Пользователь'
  async function signOut() {
    setBusy(true)
    try { const result = await supabase!.auth.signOut(); if (result.error) throw result.error; setData(blank); setModal(null); setNotice(''); go('/objects') }
    catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!modal || busy) return
    const fields = new FormData(event.currentTarget)
    const get = (name: string) => String(fields.get(name) || '').trim()
    setBusy(true); setError('')
    try {
      if (modal.kind === 'object') {
        const id = await rpc('save_object', { p_name: get('name'), p_address: get('address'), p_id: modal.item?.id || null })
        go(`/objects/${id}`)
      } else if (modal.kind === 'task') {
        const id = await rpc('save_task', { p_title: get('title'), p_description: get('description'), p_object_id: get('object_id'), p_assignee_id: get('assignee_id'), p_id: modal.item?.id || null })
        go(`/tasks/${id}`)
      } else if (modal.kind === 'status') {
        await rpc('change_task_status', { p_id: modal.task.id, p_expected_status: modal.task.status, p_status: modal.status, p_comment: get('comment') || null })
      } else {
        await rpc(`delete_${modal.entity}`, { p_id: modal.id })
        go('/objects')
      }
      setModal(null); setNotice('Изменения сохранены'); await refresh()
    } catch (e) { setError(message(e)) }
    finally { setBusy(false) }
  }
  if (!supabase) return <div className="login"><div className="login-card"><Brand /><h1>Подключите Supabase</h1><p>Укажите адрес проекта и публичный ключ в .env.local по образцу .env.example, затем перезапустите приложение. Порядок установки базы описан в README.</p></div></div>
  if (!authReady) return <div className="loading">Проверяем сессию…</div>
  if (!session) return <Login onError={setError} error={error} />
  const section = route.split('/')[1]
  const id = route.split('/')[2]
  const object = data.objects.find(o => o.id === id)
  const task = data.tasks.find(t => t.id === id)
  const filteredTasks = data.tasks.filter(t => (!query || t.title.toLowerCase().includes(query.toLowerCase())) && (filter === 'all' || t.status === filter))
  const toolbar = <div className="toolbar"><label className="search"><Search size={18} /><input aria-label="Поиск" placeholder={section === 'objects' && !id ? 'Найти объект или адрес…' : 'Найти задачу…'} value={query} onChange={e => setQuery(e.target.value)} /></label>{(id || section === 'tasks') && <select aria-label="Фильтр по статусу" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Все статусы</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}<button className="icon-button" aria-label="Обновить данные" disabled={loading} onClick={() => void refresh()}><RefreshCw size={18} className={loading ? 'spin' : ''} /></button></div>
  const taskList = (list: Task[]) => list.length ? <div className="task-list">{list.map(t => <button className="task-row" key={t.id} onClick={() => go(`/tasks/${t.id}`)}><div className="task-symbol"><CheckCheck size={20} /></div><div className="task-name"><strong>{t.title}</strong><small>{data.objects.find(o => o.id === t.object_id)?.name} · {person(t.assignee_id)}</small></div><Badge status={t.status} /><ArrowUpRight size={18} /></button>)}</div> : <Empty title="Задач пока нет">{query || filter !== 'all' ? 'Попробуйте изменить условия поиска.' : manager ? 'Создайте задачу и назначьте исполнителя.' : 'Здесь появятся назначенные вам задачи.'}</Empty>
  return <div className="app-shell">
    <aside className="sidebar"><Brand /><div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div><nav><a href="#/objects" className={section === 'objects' ? 'active' : ''}><Building2 size={20} />Объекты<span>{data.objects.length}</span></a><a href="#/tasks" className={section === 'tasks' ? 'active' : ''}><CheckCheck size={20} />{manager ? 'Все задачи' : 'Мои задачи'}<span>{data.tasks.length}</span></a></nav><div className="sidebar-bottom"><div className="secure"><ShieldCheck size={18} /><span>Доступ по вашей роли</span></div><div className="user"><div className="avatar">{profile?.full_name.slice(0, 1) || '…'}</div><div><strong>{profile?.full_name || 'Загрузка профиля'}</strong><small>{profile ? manager ? 'Постановщик' : 'Исполнитель' : session.user.email}</small></div><button className="icon-button" aria-label="Выйти" onClick={() => void signOut()} disabled={busy}><LogOut size={18} /></button></div></div></aside>
    <main><header className="topbar"><span>Строительная компания <span className="slash">/</span> Управление работами</span><span className="workspace-tag"><span /> Рабочее пространство</span></header><div className="content">
      {error && <div className="alert" role="alert">{error}<button onClick={() => setError('')} aria-label="Закрыть ошибку"><X size={16} /></button></div>}
      {notice && !error && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Закрыть уведомление"><X size={16} /></button></div>}
      {!profile ? <Empty title={loading ? 'Загружаем рабочее пространство…' : 'Профиль не настроен'}> {loading ? 'Получаем доступные вам объекты и задачи.' : 'Обратитесь к администратору для назначения роли.'}<button className="secondary" onClick={() => void refresh()}>Повторить загрузку</button></Empty> : <>
      {section === 'objects' && !id && <><div className="eyebrow">ОБЗОР ПРОЕКТОВ</div><div className="page-heading"><div><h1>Объекты</h1><p>{manager ? 'Все строительные площадки и ход работ в одном месте.' : 'Объекты, на которых вам назначены задачи.'}</p></div>{manager && <button className="primary" onClick={() => setModal({ kind: 'object' })}><Plus size={18} />Добавить объект</button>}</div><div className="stats"><Stat label="Всего объектов" value={data.objects.length} icon={<Building2 />} /><Stat label="Задач в работе" value={data.tasks.filter(t => t.status === 'in_progress').length} icon={<HardHat />} /><Stat label="Ожидают проверки" value={data.tasks.filter(t => t.status === 'review').length} icon={<CheckCheck />} /></div>{toolbar}<div className="section-caption">Строительные объекты <span>{data.objects.length}</span></div><div className="object-grid">{data.objects.filter(o => `${o.name} ${o.address}`.toLowerCase().includes(query.toLowerCase())).map((o, i) => {
        const tasks = data.tasks.filter(t => t.object_id === o.id), done = tasks.filter(t => t.status === 'accepted').length
        return <a className="object-card" href={`#/objects/${o.id}`} key={o.id}><div className={`card-art art-${i % 3}`}><Building2 size={76} strokeWidth={1} /><span>ОБЪЕКТ {String(i + 1).padStart(2, '0')}</span><div className="round-arrow"><ArrowUpRight size={20} /></div></div><div className="card-body"><h2>{o.name}</h2><p><MapPin size={15} />{o.address}</p><div className="progress-label"><span>{tasks.length} задач</span><span>{done} принято</span></div><div className="progress"><i style={{ width: `${tasks.length ? done / tasks.length * 100 : 0}%` }} /></div><div className="card-foot"><span>{tasks.some(t => t.status === 'review') ? 'Есть задачи на проверке' : tasks.length ? 'Работы на объекте' : 'Готов к первым задачам'}</span><ArrowUpRight size={16} /></div></div></a>
      })}</div>{!data.objects.length && <Empty title="Добавьте первый объект">{manager ? 'Укажите название стройки и адрес, затем создайте задачи.' : 'Объекты появятся после назначения вам задач.'}</Empty>}{data.objects.length > 0 && !data.objects.some(o => `${o.name} ${o.address}`.toLowerCase().includes(query.toLowerCase())) && <Empty title="Ничего не найдено">Попробуйте другое название или адрес.</Empty>}</>}
      {section === 'objects' && id && (object ? <><button className="back" onClick={() => go('/objects')}><ArrowLeft size={16} />Все объекты</button><div className="page-heading"><div><div className="eyebrow">КАРТОЧКА ОБЪЕКТА</div><h1>{object.name}</h1><p><MapPin size={16} />{object.address}</p></div>{manager && <div className="button-group"><button className="secondary" onClick={() => setModal({ kind: 'object', item: object })}><Pencil size={16} />Изменить</button><button className="icon-button danger" aria-label="Удалить объект" onClick={() => setModal({ kind: 'delete', entity: 'object', id: object.id, name: object.name })}><Trash2 size={18} /></button></div>}</div><div className="section-heading"><h2>Задачи объекта</h2>{manager && <button className="primary" onClick={() => setModal({ kind: 'task', objectId: object.id })}><Plus size={18} />Создать задачу</button>}</div>{toolbar}{taskList(filteredTasks.filter(t => t.object_id === object.id))}</> : <Empty title="Объект недоступен">Объект удалён или у вас нет доступа.</Empty>)}
      {section === 'tasks' && !id && <><div className="eyebrow">УПРАВЛЕНИЕ РАБОТАМИ</div><div className="page-heading"><div><h1>{manager ? 'Все задачи' : 'Мои задачи'}</h1><p>{manager ? 'Назначайте работы, проверяйте результат и принимайте задачи.' : 'Берите задачи в работу и отправляйте результат на проверку.'}</p></div>{manager && <button className="primary" disabled={!data.objects.length} onClick={() => setModal({ kind: 'task' })}><Plus size={18} />Создать задачу</button>}</div>{toolbar}{taskList(filteredTasks)}</>}
      {section === 'tasks' && id && (task ? <><button className="back" onClick={() => go(`/objects/${task.object_id}`)}><ArrowLeft size={16} />{data.objects.find(o => o.id === task.object_id)?.name || 'К объекту'}</button><div className="page-heading"><div><div className="eyebrow">КАРТОЧКА ЗАДАЧИ</div><h1>{task.title}</h1></div>{manager && <div className="button-group"><button className="secondary" onClick={() => setModal({ kind: 'task', item: task })}><Pencil size={16} />Изменить</button><button className="icon-button danger" aria-label="Удалить задачу" onClick={() => setModal({ kind: 'delete', entity: 'task', id: task.id, name: task.title })}><Trash2 size={18} /></button></div>}</div><div className="detail-grid"><section className="panel"><Badge status={task.status} /><h2>Описание задачи</h2><p className="description">{task.description || 'Описание не указано.'}</p><dl><div><dt>Исполнитель</dt><dd>{person(task.assignee_id)}</dd></div><div><dt>Постановщик</dt><dd>{person(task.author_id)}</dd></div><div><dt>Создана</dt><dd>{date(task.created_at)}</dd></div></dl><div className="actions">{actions(task, profile).map(action => <button className={action.status === 'rework' ? 'secondary' : 'primary'} key={action.status} onClick={() => setModal({ kind: 'status', task, status: action.status })}>{action.label}</button>)}{!actions(task, profile).length && <p className="muted">{task.status === 'accepted' ? 'Работа принята. Задача завершена.' : 'Следующее действие доступно ' + (task.status === 'review' ? 'постановщику.' : 'назначенному исполнителю.')}</p>}</div></section><section className="panel"><h2>История задачи</h2><p className="muted">Все изменения статуса</p><ol className="timeline">{data.history.filter(h => h.task_id === task.id).sort((a, b) => b.id - a.id).map(h => <li key={h.id}><strong>{h.from_status ? `${statuses[h.from_status]} → ${statuses[h.to_status]}` : 'Задача создана'}</strong><span>{person(h.actor_id)}</span><time>{date(h.created_at)}</time>{h.comment && <blockquote>{h.comment}</blockquote>}</li>)}</ol></section></div></> : <Empty title="Задача недоступна">Задача удалена, переназначена или у вас нет доступа.</Empty>)}
      {!['objects', 'tasks'].includes(section) && <Empty title="Страница не найдена"><a href="#/objects">Перейти к объектам</a></Empty>}
      </>}
      <footer>Контур <span>Объекты и задачи · мини-CRM</span></footer>
    </div></main>
    {modal && <ModalDialog onClose={() => { if (!busy) setModal(null) }}><form onSubmit={submit}><div className="modal-heading"><h2>{modal.kind === 'delete' ? 'Подтвердите удаление' : modal.kind === 'status' ? statuses[modal.status] : modal.kind === 'object' ? modal.item ? 'Изменить объект' : 'Новый объект' : modal.item ? 'Изменить задачу' : 'Новая задача'}</h2><button type="button" className="icon-button" aria-label="Закрыть" disabled={busy} onClick={() => setModal(null)}><X size={20} /></button></div>{error && <div className="alert" role="alert">{error}</div>}
      {modal.kind === 'object' && <><label>Название объекта<input name="name" required maxLength={160} defaultValue={modal.item?.name} placeholder="Например, ЖК Северный парк" /></label><label>Адрес<input name="address" required maxLength={300} defaultValue={modal.item?.address} placeholder="Город, улица, дом" /></label></>}
      {modal.kind === 'task' && <><label>Название задачи<input name="title" required maxLength={200} defaultValue={modal.item?.title} placeholder="Что нужно сделать?" /></label><label>Описание<textarea name="description" rows={4} maxLength={10000} defaultValue={modal.item?.description} /></label><label>Объект<select name="object_id" required defaultValue={modal.item?.object_id || modal.objectId || ''}><option value="" disabled>Выберите объект</option>{data.objects.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label><label>Исполнитель<select name="assignee_id" required defaultValue={modal.item?.assignee_id || ''}><option value="" disabled>Назначьте исполнителя</option>{data.profiles.filter(p => p.role === 'worker').map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>{!data.profiles.some(p => p.role === 'worker') && <p className="alert">Сначала администратор должен добавить исполнителя.</p>}</>}
      {modal.kind === 'status' && <><p>{modal.task.title}</p><label>Комментарий {modal.status === 'rework' ? '(обязательно)' : '(необязательно)'}<textarea name="comment" rows={4} maxLength={2000} required={modal.status === 'rework'} placeholder={modal.status === 'rework' ? 'Что нужно исправить?' : 'Дополнительная информация'} /></label></>}
      {modal.kind === 'delete' && <p>Удалить «{modal.name}»? {modal.entity === 'object' ? 'Все задачи объекта и их история будут удалены.' : 'История задачи также будет удалена.'} Это действие нельзя отменить.</p>}
      <div className="modal-footer"><button type="button" className="secondary" disabled={busy} onClick={() => setModal(null)}>Отмена</button><button className={modal.kind === 'delete' ? 'delete-button' : 'primary'} disabled={busy}>{busy ? 'Сохраняем…' : modal.kind === 'delete' ? 'Удалить' : modal.kind === 'status' ? 'Подтвердить' : 'Сохранить'}</button></div>
    </form></ModalDialog>}
  </div>
}
function Brand() { return <div className="brand"><div><Building2 size={24} /></div><span>контур<small>ОБЪЕКТЫ И ЗАДАЧИ</small></span></div> }
function Stat({ label, value, icon }: { label: string; value: number; icon: ReactNode }) { return <div className="stat"><div><span>{label}</span><strong>{value.toString().padStart(2, '0')}</strong></div><div className="stat-icon">{icon}</div></div> }
function ModalDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal(); const dialog = ref.current; return () => dialog?.close() }, [])
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); onClose() }}>{children}</dialog>
}
function Login({ error, onError }: { error: string; onError: (e: string) => void }) {
  const [busy, setBusy] = useState(false)
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); onError('')
    const form = new FormData(e.currentTarget)
    try { const { error } = await supabase!.auth.signInWithPassword({ email: String(form.get('email')).trim(), password: String(form.get('password')) }); if (error) onError('Не удалось войти. Проверьте email и пароль, а также подключение к сети.') }
    catch { onError('Сервис недоступен. Попробуйте позже.') } finally { setBusy(false) }
  }
  return <div className="login"><div className="login-story"><Brand /><div><div className="eyebrow">ОТ ПЛАНА К РЕЗУЛЬТАТУ</div><h1>Каждая задача.<br />Каждый объект.<br /><em>Под контролем.</em></h1><p>Единое пространство для команды,<br />которая строит.</p><div className="building-illustration"><Building2 size={180} strokeWidth={0.65} /><HardHat size={100} strokeWidth={0.8} /></div></div><span>Контур · управление строительными работами</span></div><div className="login-main"><form className="login-card" onSubmit={login}><div className="login-icon"><ShieldCheck size={26} /></div><h2>Вход в рабочее пространство</h2><p>Войдите, чтобы продолжить работу с объектами и задачами.</p>{error && <div role="alert" className="alert">{error}</div>}<label>Email<input name="email" type="email" required autoComplete="username" placeholder="name@company.ru" /></label><label>Пароль<input name="password" type="password" required autoComplete="current-password" placeholder="Введите пароль" /></label><button className="primary" disabled={busy}>{busy ? 'Входим…' : 'Войти'}<ArrowUpRight size={18} /></button><div className="login-note">Доступ предоставляет администратор.<br />Для получения учётной записи обратитесь к руководителю.</div></form></div></div>
}
