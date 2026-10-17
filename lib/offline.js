// Cópia local dos treinos + fila de marcações feitas sem internet.
// Formato do cache: { dia, treinos, agenda: [{ weekday, workout_id }], feitos: ['ex:<id>'] }
// Formato da fila: [{ marcar: true|false, key: 'ex:<id>', day: 'AAAA-MM-DD' }]

const CACHE_KEY = 'treinos-cache'
const FILA_KEY = 'fila-offline'

const ler = (k, padrao) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? padrao } catch { return padrao }
}
const gravar = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch {}
}

// Erro de rede do supabase-js vem sem código do Postgres.
export const erroDeRede = (error) => Boolean(error) && (!navigator.onLine || !error.code)

export const lerCacheTreinos = () => ler(CACHE_KEY, null)
export const salvarCacheTreinos = (dados) => gravar(CACHE_KEY, dados)

export const lerFila = () => ler(FILA_KEY, [])

export function enfileirar(op) {
  // Só a última ação de cada item/dia importa.
  const fila = lerFila().filter((o) => !(o.key === op.key && o.day === op.day))
  gravar(FILA_KEY, [...fila, op])
}

// Aplica a fila pendente sobre os "feitos" de um dia (para a tela refletir o que foi marcado offline).
export function aplicarFila(feitos, dia) {
  const s = new Set(feitos)
  lerFila().filter((o) => o.day === dia).forEach((o) => (o.marcar ? s.add(o.key) : s.delete(o.key)))
  return s
}

let sincronizando = null
export function sincronizar(sb) {
  if (!sincronizando) sincronizando = enviarFila(sb).finally(() => { sincronizando = null })
  return sincronizando
}

const mesmaOp = (a, b) => a.key === b.key && a.day === b.day && a.marcar === b.marcar

async function enviarFila(sb) {
  const fila = lerFila()
  const enviados = []
  for (const o of fila) {
    const { error } = o.marcar
      ? await sb.from('plan_done').insert({ key: o.key, day: o.day })
      : await sb.from('plan_done').delete().eq('key', o.key).eq('day', o.day)
    // Sem internet: para e tenta de novo depois. Já marcado (23505) ou outro erro do banco: descarta.
    if (error && error.code !== '23505' && erroDeRede(error)) break
    enviados.push(o)
  }
  // Relê a fila: ela pode ter mudado enquanto enviava.
  gravar(FILA_KEY, lerFila().filter((o) => !enviados.some((e) => mesmaOp(e, o))))
  return enviados.length
}
