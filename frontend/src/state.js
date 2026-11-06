import { createContext } from 'react'

export const ConfigCtx = createContext({ models: {}, text_encoders: {}, vaes: {}, upscalers: [] })

export async function api(path, opts) {
  const res = await fetch(path, opts)
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { error: text } }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}
