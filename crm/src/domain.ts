export type Role = 'manager' | 'worker'
export type Status = 'new' | 'in_progress' | 'review' | 'accepted' | 'rework'
export type Profile = { id: string; full_name: string; role: Role }
export type SiteObject = { id: string; name: string; address: string; created_at: string }
export type Task = { id: string; title: string; description: string; object_id: string; assignee_id: string; author_id: string; created_at: string; status: Status }
export type History = { id: number; task_id: string; actor_id: string; created_at: string; from_status: Status | null; to_status: Status; comment: string | null }
export const statuses: Record<Status, string> = { new: 'Новая', in_progress: 'В работе', review: 'На проверке', accepted: 'Принята', rework: 'На доработке' }
export function actions(task: Task, profile: Profile): { status: Status; label: string }[] {
  if (profile.role === 'manager') return task.status === 'review' ? [{ status: 'accepted', label: 'Принять задачу' }, { status: 'rework', label: 'Вернуть на доработку' }] : []
  if (task.assignee_id !== profile.id) return []
  if (task.status === 'new' || task.status === 'rework') return [{ status: 'in_progress', label: 'Взять в работу' }]
  return task.status === 'in_progress' ? [{ status: 'review', label: 'Отправить на проверку' }] : []
}
