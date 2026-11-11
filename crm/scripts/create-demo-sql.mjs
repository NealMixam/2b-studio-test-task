import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
const folder = new URL('../../.tmp/', import.meta.url)
mkdirSync(folder, { recursive: true })
if (existsSync(new URL('demo-access.json', folder))) throw new Error('Доступы уже созданы. Файл сохранён без изменений.')
const accounts = [
  { email: 'manager@kontur-demo.example', full_name: 'Алексей Смирнов', role: 'manager' },
  { email: 'ivan@kontur-demo.example', full_name: 'Иван Петров', role: 'worker' },
  { email: 'maria@kontur-demo.example', full_name: 'Мария Волкова', role: 'worker' },
].map(a => ({ ...a, id: randomUUID(), password: randomBytes(18).toString('base64url') }))
const quote = value => "'" + value.replaceAll("'", "''") + "'"
const sql = [`-- Только для отдельного тестового проекта. Выполнить один раз в SQL Editor.`, 'begin;']
for (const a of accounts) {
  sql.push(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token)
values('00000000-0000-0000-0000-000000000000',${quote(a.id)},'authenticated','authenticated',${quote(a.email)},extensions.crypt(${quote(a.password)},extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}',jsonb_build_object('full_name',${quote(a.full_name)}),now(),now(),'','','','','','');
insert into auth.identities(id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
values(gen_random_uuid(),${quote(a.id)},${quote(a.id)},jsonb_build_object('sub',${quote(a.id)},'email',${quote(a.email)},'email_verified',true),'email',now(),now(),now());
insert into public.profiles(id,full_name,role) values(${quote(a.id)},${quote(a.full_name)},${quote(a.role)});`)
}
const manager = accounts[0].id, worker = accounts[1].id, other = accounts[2].id
sql.push(`select set_config('request.jwt.claim.sub', '${manager}', true);`)
sql.push(`do $$
declare a uuid; b uuid; c uuid; t uuid;
begin
  a := public.save_object('ЖК Северный парк', 'Москва, ул. Лесная, 12');
  b := public.save_object('Бизнес-центр Горизонт', 'Москва, пр-т Мира, 48');
  c := public.save_object('Складской комплекс Восток', 'Балашиха, ш. Энтузиастов, 7');
  perform public.save_task('Подготовить площадку под фундамент','Проверить разметку осей и подготовить акт готовности площадки.',a,'${worker}');
  t := public.save_task('Проверить армирование перекрытия','Проверить защитный слой, шаг стержней и соединения.',a,'${worker}');
  perform set_config('request.jwt.claim.sub','${worker}',true);
  perform public.change_task_status(t,'new','in_progress','Приступил к проверке второго этажа.');
  perform set_config('request.jwt.claim.sub','${manager}',true);
  t := public.save_task('Согласовать разводку электрики','Проверить соответствие трасс рабочим чертежам.',b,'${other}');
  perform set_config('request.jwt.claim.sub','${other}',true);
  perform public.change_task_status(t,'new','in_progress');
  perform public.change_task_status(t,'in_progress','review','Трассы проверены, замечания устранены.');
  perform set_config('request.jwt.claim.sub','${manager}',true);
  t := public.save_task('Принять поставку материалов','Сверить количество и проверить сертификаты качества.',c,'${other}');
  perform set_config('request.jwt.claim.sub','${other}',true);
  perform public.change_task_status(t,'new','in_progress');
  perform public.change_task_status(t,'in_progress','review');
  perform set_config('request.jwt.claim.sub','${manager}',true);
  perform public.change_task_status(t,'review','accepted','Количество и документы соответствуют заявке.');
  t := public.save_task('Проверить гидроизоляцию','Осмотреть примыкания и герметичность швов.',a,'${worker}');
  perform set_config('request.jwt.claim.sub','${worker}',true);
  perform public.change_task_status(t,'new','in_progress');
  perform public.change_task_status(t,'in_progress','review');
  perform set_config('request.jwt.claim.sub','${manager}',true);
  perform public.change_task_status(t,'review','rework','Повторно обработать примыкание в северном углу и проверить шов.');
  perform public.save_task('Провести инструктаж бригады','Провести вводный инструктаж и заполнить журнал.',b,'${worker}');
end $$;
commit;
select (select count(*) from public.profiles) as users, (select count(*) from public.objects) as objects, (select count(*) from public.tasks) as tasks;`)
writeFileSync(new URL('setup-demo.sql', folder), sql.join('\n\n'))
writeFileSync(new URL('demo-access.json', folder), JSON.stringify(accounts, null, 2))
writeFileSync(new URL('Доступы для проверки.md', folder), '# Тестовые доступы\n\nТолько для передачи проверяющему. Не публиковать в Git.\n\n' + accounts.map(a => `- ${a.role === 'manager' ? 'Постановщик' : 'Исполнитель'} — ${a.full_name}\n  Email: ${a.email}\n  Пароль: ${a.password}\n`).join('\n'))
console.log('Созданы .tmp/setup-demo.sql и локальные файлы доступов. Пароли не выведены.')
