// Cópia local dos treinos + fila de alterações feitas sem internet.
// Formato do cache: { dia, treinos, agenda: [{ weekday, workout_id }], feitos: ['ex:<id>'] }
// Formato da fila:
//   marcação: { marcar: true|false, key: 'ex:<id>', day: 'AAAA-MM-DD' }
//   carga:    { tipo: 'carga', workoutId, exId, load: '40' }

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

// Só a última alteração de cada item importa.
const alvo = (o) => (o.tipo === 'carga' ? 'carga:' + o.exId : o.key + '|' + o.day)

export function enfileirar(op) {
  const fila = lerFila().filter((o) => alvo(o) !== alvo(op))
  gravar(FILA_KEY, [...fila, op])
}

// Aplica as marcações pendentes sobre os "feitos" de um dia (para a tela refletir o que foi marcado offline).
export function aplicarFila(feitos, dia) {
  const s = new Set(feitos)
  lerFila().filter((o) => !o.tipo && o.day === dia).forEach((o) => (o.marcar ? s.add(o.key) : s.delete(o.key)))
  return s
}

// Um envio por vez; cada chamada entra na fila de envios (nada fica esperando a próxima ação).
let cadeia = Promise.resolve(0)
export function sincronizar(sb) {
  cadeia = cadeia.then(() => enviarFila(sb), () => enviarFila(sb))
  return cadeia
}

const mesmaOp = (a, b) => JSON.stringify(a) === JSON.stringify(b)

async function enviarCarga(sb, o) {
  const { data, error } = await sb.from('workouts').select('exercises').eq('id', o.workoutId).maybeSingle()
  if (error || !data) return { error } // treino apagado: descarta
  const exercises = (data.exercises || []).map((x) => (x.id === o.exId ? { ...x, load: o.load } : x))
  return sb.from('workouts').update({ exercises }).eq('id', o.workoutId)
}

async function enviarFila(sb) {
  const fila = lerFila()
  const enviados = []
  for (const o of fila) {
    const { error } = o.tipo === 'carga'
      ? await enviarCarga(sb, o)
      : o.marcar
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
