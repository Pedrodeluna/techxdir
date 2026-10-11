#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const children = new Set()
let stopping = false

function stop(code = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* already stopped */ }
  }
  const timeout = setTimeout(() => {
    for (const child of children) {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* already stopped */ }
    }
  }, 3000)
  timeout.unref()
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

function run(command, args, { capture = false, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    if (stopping) return resolve('')
    const child = spawn(command, args, {
      cwd: root, env, detached: true,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    children.add(child)
    let output = ''
    if (capture) child.stdout.on('data', chunk => { output += chunk })
    child.on('error', error => {
      children.delete(child)
      reject(new Error(`No se pudo ejecutar ${command}: ${error.message}`))
    })
    child.on('close', code => {
      children.delete(child)
      if (stopping || code === 0) resolve(output)
      else reject(new Error(`${command} ${args.join(' ')} terminó con código ${code}.`))
    })
  })
}

try {
  await access(new URL('../node_modules', import.meta.url)).catch(() => {
    throw new Error('Faltan las dependencias. Ejecuta npm ci primero.')
  })
  await run('supabase', ['--version'], { capture: true })
  await run('docker', ['info'], { capture: true }).catch(() => {
    throw new Error('Abre OrbStack o Docker Desktop y vuelve a ejecutar npm run dev:local.')
  })
  console.log('\nArrancando Supabase local…')
  await run('supabase', ['start'])
  if (!stopping) {
    const status = JSON.parse(await run('supabase', ['status', '-o', 'json'], { capture: true }))
    if (!status.API_URL || !status.ANON_KEY) throw new Error('Supabase no devolvió la URL y la clave pública locales.')
    const env = {
      ...process.env,
      VITE_SUPABASE_URL: status.API_URL,
      VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
      VITE_X_AUTH_PROVIDER: 'twitter',
    }
    console.log('\nIniciando funciones y frontend con Supabase local.')
    console.log('Frontend: http://127.0.0.1:55330')
    console.log('Studio:   http://127.0.0.1:55323')
    console.log('Ctrl+C cierra funciones y frontend. Supabase queda encendido; usa supabase stop para pararlo.\n')
    await Promise.race([
      run('supabase', ['functions', 'serve']),
      run('npm', ['run', 'dev'], { env }),
    ])
    stop()
  }
} catch (error) {
  if (!stopping) console.error(`\n${error.message}`)
  stop(1)
}
