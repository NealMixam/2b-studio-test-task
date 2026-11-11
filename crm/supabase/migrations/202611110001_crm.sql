begin;

create type public.app_role as enum ('manager', 'worker');
create type public.task_status as enum ('new', 'in_progress', 'review', 'accepted', 'rework');
create table public.profiles (
  id uuid primary key references auth.users(id),
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  role public.app_role not null default 'worker'
);
create table public.objects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  address text not null check (length(trim(address)) between 1 and 300),
  created_at timestamptz not null default now()
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 10000),
  object_id uuid not null references public.objects(id) on delete cascade,
  assignee_id uuid not null references public.profiles(id),
  status public.task_status not null default 'new',
  author_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  last_comment text check (length(last_comment) <= 2000)
);
create table public.task_history (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  from_status public.task_status,
  to_status public.task_status not null,
  comment text
);
create index tasks_assignee_idx on public.tasks(assignee_id);
create index tasks_object_idx on public.tasks(object_id);
create index history_task_idx on public.task_history(task_id, id);

-- Role is stored in a protected table, never in editable user_metadata.
create function public.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'manager');
$$;

alter table public.profiles enable row level security;
alter table public.objects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_history enable row level security;

create policy tasks_read on public.tasks for select to authenticated
using (public.is_manager() or assignee_id = (select auth.uid()));
create policy objects_read on public.objects for select to authenticated
using (public.is_manager() or exists(select 1 from public.tasks t where t.object_id = objects.id and t.assignee_id = (select auth.uid())));
create policy history_read on public.task_history for select to authenticated
using (exists(select 1 from public.tasks t where t.id = task_history.task_id));
create policy profiles_read on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.is_manager()
  or exists(select 1 from public.tasks t where t.author_id = profiles.id)
  or exists(select 1 from public.task_history h where h.actor_id = profiles.id));

-- Defense in depth: no write policies AND no table write grants.
revoke all on public.profiles, public.objects, public.tasks, public.task_history from anon, authenticated;
grant select on public.profiles, public.objects, public.tasks, public.task_history to authenticated;

create function public.save_object(p_name text, p_address text, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if not public.is_manager() then raise exception 'Только постановщик может изменять объекты' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.objects(name, address) values(trim(p_name), trim(p_address)) returning id into result;
  else
    update public.objects set name = trim(p_name), address = trim(p_address) where id = p_id returning id into result;
    if result is null then raise exception 'Объект не найден'; end if;
  end if;
  return result;
end $$;

create function public.delete_object(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager() then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
  delete from public.objects where id = p_id;
  if not found then raise exception 'Объект не найден'; end if;
end $$;

create function public.save_task(p_title text, p_description text, p_object_id uuid, p_assignee_id uuid, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if not public.is_manager() then raise exception 'Только постановщик может изменять задачи' using errcode = '42501'; end if;
  if not exists(select 1 from public.profiles where id = p_assignee_id and role = 'worker') then
    raise exception 'Назначить можно только исполнителя';
  end if;
  if p_id is null then
    insert into public.tasks(title, description, object_id, assignee_id, author_id)
    values(trim(p_title), coalesce(p_description, ''), p_object_id, p_assignee_id, auth.uid()) returning id into result;
  else
    update public.tasks set title = trim(p_title), description = coalesce(p_description, ''),
      object_id = p_object_id, assignee_id = p_assignee_id where id = p_id returning id into result;
    if result is null then raise exception 'Задача не найдена'; end if;
  end if;
  return result;
end $$;

create function public.delete_task(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager() then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
  delete from public.tasks where id = p_id;
  if not found then raise exception 'Задача не найдена'; end if;
end $$;

-- The trigger enforces the graph even for UPDATEs outside the RPC.
create function public.guard_task_status() returns trigger
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
    if new.status = 'rework' and nullif(trim(new.last_comment), '') is null then
      raise exception 'Для возврата на доработку нужен комментарий';
    end if;
  end if;
  return new;
end $$;
create trigger guard_task_status before insert or update on public.tasks
for each row execute function public.guard_task_status();

create function public.audit_task_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.task_history(task_id, actor_id, from_status, to_status, comment)
    values(new.id, auth.uid(), null, new.status, null);
  elsif new.status is distinct from old.status then
    insert into public.task_history(task_id, actor_id, from_status, to_status, comment)
    values(new.id, auth.uid(), old.status, new.status, nullif(trim(new.last_comment), ''));
  end if;
  return new;
end $$;
create trigger audit_task_status after insert or update on public.tasks
for each row execute function public.audit_task_status();

create function public.change_task_status(p_id uuid, p_expected_status public.task_status, p_status public.task_status, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare task public.tasks;
begin
  select * into task from public.tasks where id = p_id for update;
  if not found or not (public.is_manager() or task.assignee_id = auth.uid()) or auth.uid() is null then
    raise exception 'Задача недоступна' using errcode = '42501';
  end if;
  if task.status <> p_expected_status then raise exception 'Задача уже изменена. Обновите страницу'; end if;
  if task.status = p_status then raise exception 'Статус уже установлен'; end if;
  update public.tasks set status = p_status, last_comment = nullif(trim(p_comment), '') where id = p_id;
end $$;

revoke all on function public.is_manager() from public, anon, authenticated;
revoke all on function public.save_object(text,text,uuid) from public, anon, authenticated;
revoke all on function public.delete_object(uuid) from public, anon, authenticated;
revoke all on function public.save_task(text,text,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.delete_task(uuid) from public, anon, authenticated;
revoke all on function public.change_task_status(uuid,public.task_status,public.task_status,text) from public, anon, authenticated;
revoke all on function public.guard_task_status() from public, anon, authenticated;
revoke all on function public.audit_task_status() from public, anon, authenticated;
grant execute on function public.is_manager(), public.save_object(text,text,uuid), public.delete_object(uuid),
  public.save_task(text,text,uuid,uuid,uuid), public.delete_task(uuid),
  public.change_task_status(uuid,public.task_status,public.task_status,text) to authenticated;
commit;
