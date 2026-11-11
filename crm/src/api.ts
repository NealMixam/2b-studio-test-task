import { createClient } from '@supabase/supabase-js'
const env = import.meta.env
const url = env.VITE_SUPABASE_URL as string | undefined
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
export const supabase = url && key && !url.includes('YOUR_PROJECT') ? createClient(url, key) : null
export async function rows<T>(table: string): Promise<T[]> {
  if (!supabase) throw new Error('Supabase не настроен')
  const result: T[] = []
  for (let start = 0; ; start += 500) {
    const { data, error } = await supabase.from(table).select('*').order('id').range(start, start + 499)
    if (error) throw error
    result.push(...data as T[])
    if (data.length < 500) return result
  }
}
export async function rpc(name: string, args: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}
