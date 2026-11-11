begin;

-- Reject whitespace-only comments and NULL optimistic-lock tokens.
create or replace function public.guard_task_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    if not public.is_manager() or new.status <> 'new' or new.author_id <> auth.uid() then
      raise exception 'Недопустимое создание задачи' using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    if new.assignee_id <> old.assignee_id or new.author_id <> old.author_id or new.object_id <> old.object_id then
      raise exception 'Нельзя менять реквизиты одновременно со статусом';
    end if;
    if not (
      (auth.uid() = old.assignee_id and exists(select 1 from public.profiles where id = auth.uid() and role = 'worker') and
       ((old.status in ('new', 'rework') and new.status = 'in_progress') or (old.status = 'in_progress' and new.status = 'review')))
      or (public.is_manager() and old.status = 'review' and new.status in ('accepted', 'rework'))
    ) then raise exception 'Переход статуса запрещён' using errcode = '42501'; end if;
    if new.status = 'rework' and (new.last_comment is null or new.last_comment !~ '[^[:space:]]') then
      raise exception 'Для возврата на доработку нужен комментарий';
    end if;
  end if;
  return new;
end $$;

create or replace function public.change_task_status(p_id uuid, p_expected_status public.task_status, p_status public.task_status, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare task public.tasks;
begin
  if p_status is null then raise exception 'Новый статус обязателен'; end if;
  select * into task from public.tasks where id = p_id for update;
  if not found or not (public.is_manager() or task.assignee_id = auth.uid()) or auth.uid() is null then
    raise exception 'Задача недоступна' using errcode = '42501';
  end if;
  if p_expected_status is null or task.status is distinct from p_expected_status then raise exception 'Задача уже изменена. Обновите страницу'; end if;
  if task.status = p_status then raise exception 'Статус уже установлен'; end if;
  update public.tasks set status = p_status, last_comment = nullif(trim(p_comment), '') where id = p_id;
end $$;

revoke all on public.profiles, public.objects, public.tasks, public.task_history from public;
commit;
