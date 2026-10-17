'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { aplicarFila, enfileirar, erroDeRede, lerCacheTreinos, salvarCacheTreinos, sincronizar } from '../lib/offline'

const hoje = () => new Date().toLocaleDateString('sv-SE') // AAAA-MM-DD no fuso do celular
const num = (v) => Number(String(v).replace(',', '.'))
const fmt = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',')

// Valores aproximados. Confira o rótulo do produto e ajuste na aba Alimentos.
const SUGESTOES = [
  { name: 'Ovo', unit: '1 unidade', protein: 6 },
  { name: 'Leite', unit: '1 copo (200 ml)', protein: 6.5 },
  { name: 'Presunto', unit: '2 fatias', protein: 5 },
  { name: 'Mussarela', unit: '2 fatias', protein: 6 },
  { name: 'Frango grelhado', unit: '100 g', protein: 30 },
  { name: 'Carne moída cozida', unit: '100 g', protein: 26 },
  { name: 'Sardinha em lata', unit: '1 lata', protein: 22 },
  { name: 'Atum em lata', unit: '1 lata (drenada)', protein: 25 },
  { name: 'Feijão cozido', unit: '1 concha', protein: 5 },
  { name: 'Lentilha cozida', unit: '100 g', protein: 9 },
  { name: 'Iogurte natural', unit: '1 pote (170 g)', protein: 6 },
  { name: 'Whey protein', unit: '1 scoop (30 g)', protein: 24 },
]

const REAVALIACAO_PADRAO = '2026-10-19' // peso + medidas, de manhã, em jejum, fora da menstruação

const TREINOS = [
  { nome: 'Sem musculação (descanso)', musc: false }, // domingo
  { nome: 'Costas + bíceps', musc: true },
  { nome: 'Pernas (quadríceps + glúteo)', musc: true },
  { nome: 'Peito + ombro + tríceps', musc: true },
  { nome: 'Posterior + glúteo', musc: true },
  { nome: 'Costas + bíceps (mais leve) + abdômen', musc: true },
  { nome: 'Sem musculação (descanso)', musc: false }, // sábado
]

const CARDAPIO = [
  { k: 'cafe', t: 'Café da manhã', d: '2 ovos mexidos · 1 pão com 1 fatia de mussarela · 1 copo de leite (200 ml)' },
  { k: 'almoco', t: 'Almoço', d: '4 a 5 colheres de arroz · 2 ovos ou a mistura do dia · salada ou legume, se tiver' },
  { k: 'lanche', t: 'Lanche da tarde', d: 'Pão + 2 fatias de presunto + 1 de mussarela · 1 fruta, quando tiver' },
  { k: 'jantar', t: 'Jantar', d: '2 a 3 colheres de arroz · omelete de 2 ovos com 1 fatia de presunto · 1 copo de leite, se tiver espaço' },
]

// Medidas de quando pesava 60 kg (referência)
const MEDIDAS = [
  { k: 'peso', label: 'Peso (kg)', base: 60 },
  { k: 'cintura', label: 'Cintura', base: 69 },
  { k: 'quadril', label: 'Quadril', base: 90 },
  { k: 'gluteo', label: 'Glúteo', base: 94 },
  { k: 'culote', label: 'Culote', base: 89 },
  { k: 'coxa_d', label: 'Coxa D', base: 58 },
  { k: 'coxa_e', label: 'Coxa E', base: 58 },
  { k: 'pan_d', label: 'Panturrilha D', base: 34 },
  { k: 'pan_e', label: 'Panturrilha E', base: 34 },
  { k: 'torax', label: 'Tórax', base: 87 },
  { k: 'ombros', label: 'Ombros', base: 102 },
  { k: 'braco_d', label: 'Braço D', base: 31 },
  { k: 'braco_e', label: 'Braço E', base: 31 },
  { k: 'ante_d', label: 'Antebraço D', base: 24 },
  { k: 'ante_e', label: 'Antebraço E', base: 24 },
]

export default function Page() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const sb = getSupabase()
    sb.auth.getSession().then(({ data }) => {
      setSession(comFallbackOffline(data.session))
      setReady(true)
    })
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(comFallbackOffline(s)))
    registrarServiceWorker()
    return () => data.subscription.unsubscribe()
  }, [])

  if (!ready) return null
  return session ? <App /> : <Auth />
}

// Sem internet o token não renova e o Supabase devolve sessão nula.
// Se havia login salvo neste aparelho, entra mesmo assim (os dados vêm do cache local).
function comFallbackOffline(s) {
  if (s || navigator.onLine) return s
  try {
    const salvo = Object.keys(localStorage).some((k) => /^sb-.+-auth-token$/.test(k))
    return salvo ? { offline: true } : null
  } catch { return null }
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return
  navigator.serviceWorker.register('/sw.js').catch(() => {})
  navigator.serviceWorker.ready.then((reg) => {
    // Guarda também o JS/CSS que já foi baixado antes do service worker assumir.
    const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.startsWith(location.origin + '/_next/static/'))
    if (reg.active) reg.active.postMessage({ tipo: 'cachear', urls })
  })
}

function Auth() {
  const [modo, setModo] = useState('entrar')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [busy, setBusy] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    setErro(''); setAviso(''); setBusy(true)
    const sb = getSupabase()
    const { data, error } =
      modo === 'entrar'
        ? await sb.auth.signInWithPassword({ email, password: senha })
        : await sb.auth.signUp({ email, password: senha })
    setBusy(false)
    if (error) return setErro(traduz(error.message))
    if (modo === 'criar' && !data.session) setAviso('Conta criada. Confirme o e-mail que enviamos e depois entre.')
  }

  return (
    <div className="auth">
      <h1>Meu Plano</h1>
      <p className="sub">Proteína, peso e rotina do dia.</p>
      <form className="stack" onSubmit={enviar}>
        <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <input type="password" placeholder="Senha (mínimo 6 caracteres)" value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={6} autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} />
        {erro && <div className="error">{erro}</div>}
        {aviso && <div className="sub">{aviso}</div>}
        <button className="btn" disabled={busy} style={{ width: '100%' }}>{modo === 'entrar' ? 'Entrar' : 'Criar conta'}</button>
      </form>
      <button className="linkish" style={{ marginTop: 14 }} onClick={() => { setModo(modo === 'entrar' ? 'criar' : 'entrar'); setErro(''); setAviso('') }}>
        {modo === 'entrar' ? 'Ainda não tenho conta' : 'Já tenho conta'}
      </button>
    </div>
  )
}

function traduz(msg) {
  if (/invalid login/i.test(msg)) return 'E-mail ou senha incorretos.'
  if (/already registered/i.test(msg)) return 'Este e-mail já tem conta. Toque em "Já tenho conta".'
  if (/at least 6/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres.'
  if (/not confirmed/i.test(msg)) return 'Confirme o e-mail antes de entrar.'
  return msg
}

function App() {
  const [aba, setAba] = useState('hoje')
  const [toast, setToast] = useState('')
  const sb = getSupabase()

  const avisar = useCallback((t) => {
    setToast(t)
    setTimeout(() => setToast(''), 1800)
  }, [])

  // Envia as marcações feitas offline assim que houver internet.
  useEffect(() => {
    const enviar = () => sincronizar(sb).then((n) => n && avisar(n + (n === 1 ? ' marcação sincronizada' : ' marcações sincronizadas')))
    enviar()
    window.addEventListener('online', enviar)
    return () => window.removeEventListener('online', enviar)
  }, [sb, avisar])

  return (
    <>
      <div className={'shell' + (aba === 'treinos' ? ' wide' : '')}>
        {aba === 'hoje' && <Hoje sb={sb} />}
        {aba === 'alimentos' && <Alimentos sb={sb} avisar={avisar} />}
        {aba === 'peso' && <Peso sb={sb} />}
        {aba === 'medidas' && <Medidas sb={sb} />}
        {aba === 'treinos' && <Treinos sb={sb} avisar={avisar} />}
        <button className="linkish" style={{ marginTop: 28 }} onClick={() => sb.auth.signOut()}>Sair da conta</button>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
      <nav className="tabs">
        {[['hoje', 'Hoje'], ['alimentos', 'Alimentos'], ['peso', 'Peso'], ['medidas', 'Medidas'], ['treinos', 'Treinos']].map(([k, label]) => (
          <button key={k} className={aba === k ? 'on' : ''} onClick={() => setAba(k)}>{label}</button>
        ))}
      </nav>
    </>
  )
}

/* ---------- HOJE ---------- */

function Hoje({ sb }) {
  const dia = hoje()
  const [meta, setMeta] = useState(110)
  const [refeicoes, setRefeicoes] = useState([])
  const [itens, setItens] = useState([])
  const [feitos, setFeitos] = useState(new Set())
  const [nome, setNome] = useState('')
  const [prot, setProt] = useState('')
  const [novoItem, setNovoItem] = useState('')

  const carregar = useCallback(async () => {
    const [m, i, d] = await Promise.all([
      sb.from('meals').select('*').eq('day', dia).order('created_at'),
      sb.from('checklist_items').select('*').order('created_at'),
      sb.from('checklist_done').select('item_id').eq('day', dia),
    ])
    setRefeicoes(m.data || [])
    setItens(i.data || [])
    setFeitos(new Set((d.data || []).map((x) => x.item_id)))
  }, [sb, dia])

  useEffect(() => {
    const salvo = Number(localStorage.getItem('meta'))
    if (salvo > 0) setMeta(salvo)
    carregar()
  }, [carregar])

  const total = refeicoes.reduce((s, r) => s + Number(r.protein), 0)
  const pct = Math.min(1, total / meta)
  const C = 2 * Math.PI * 62
  const falta = Math.max(0, meta - total)

  function mudarMeta() {
    const v = num(prompt('Qual a meta de proteína por dia (em gramas)?', meta))
    if (v > 0) { setMeta(v); localStorage.setItem('meta', String(v)) }
  }

  async function addRefeicao(e) {
    e.preventDefault()
    if (!nome.trim()) return
    const { error } = await sb.from('meals').insert({ day: dia, name: nome.trim(), protein: num(prot) || 0 })
    if (!error) { setNome(''); setProt(''); carregar() }
  }

  async function delRefeicao(id) {
    await sb.from('meals').delete().eq('id', id)
    carregar()
  }

  async function alternar(id) {
    if (feitos.has(id)) await sb.from('checklist_done').delete().eq('item_id', id).eq('day', dia)
    else await sb.from('checklist_done').insert({ item_id: id, day: dia })
    carregar()
  }

  async function addItem(e) {
    e.preventDefault()
    if (!novoItem.trim()) return
    await sb.from('checklist_items').insert({ title: novoItem.trim() })
    setNovoItem(''); carregar()
  }

  async function delItem(id) {
    if (!confirm('Remover este item da lista?')) return
    await sb.from('checklist_items').delete().eq('id', id)
    carregar()
  }

  return (
    <>
      <h1>Hoje</h1>
      <p className="sub">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>

      <div className="card ring-wrap">
        <div className={'ring' + (total >= meta ? ' ok' : '')}>
          <svg viewBox="0 0 150 150" aria-hidden="true">
            <circle className="track" cx="75" cy="75" r="62" fill="none" strokeWidth="14" />
            <circle className="bar" cx="75" cy="75" r="62" fill="none" strokeWidth="14" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
          </svg>
          <div className="center">
            <div className="num">{fmt(total)}</div>
            <div className="of">de {fmt(meta)} g</div>
          </div>
        </div>
        <div className="ring-text">
          {total >= meta ? <b>Meta batida!</b> : <><b>Faltam {fmt(falta)} g</b><br />de proteína hoje</>}
          <br />
          <button className="linkish" onClick={mudarMeta}>Mudar meta</button>
        </div>
      </div>

      <PlanoDoDia sb={sb} dia={dia} />

      <h2>O que comi</h2>
      <form className="form" onSubmit={addRefeicao}>
        <input type="text" placeholder="Ex.: 2 ovos mexidos" value={nome} onChange={(e) => setNome(e.target.value)} />
        <input type="number" inputMode="decimal" step="any" placeholder="g prot." value={prot} onChange={(e) => setProt(e.target.value)} />
        <button className="btn">Salvar</button>
      </form>
      <div className="stack" style={{ marginTop: 10 }}>
        {refeicoes.length === 0 && <div className="empty">Nada registrado ainda. Use o formulário acima ou a aba Alimentos.</div>}
        {refeicoes.map((r) => (
          <div key={r.id} className="card item">
            <div className="grow t">{r.name}</div>
            <span className="pill">{fmt(Number(r.protein))} g</span>
            <button className="icon-btn" aria-label={'Apagar ' + r.name} onClick={() => delRefeicao(r.id)}>×</button>
          </div>
        ))}
      </div>

      <h2>Checklist do dia</h2>
      <div className="stack">
        {itens.length === 0 && <div className="empty">Crie itens que se repetem todo dia, como "beber 2 L de água".</div>}
        {itens.map((it) => {
          const on = feitos.has(it.id)
          return (
            <div key={it.id} className="card item">
              <button className={'check' + (on ? ' on' : '')} aria-label={on ? 'Desmarcar' : 'Marcar como feito'} aria-pressed={on} onClick={() => alternar(it.id)}>{on ? '✓' : ''}</button>
              <div className={'grow t' + (on ? ' done-text' : '')}>{it.title}</div>
              <button className="icon-btn" aria-label={'Remover ' + it.title} onClick={() => delItem(it.id)}>×</button>
            </div>
          )
        })}
      </div>
      <form className="form two" style={{ marginTop: 10 }} onSubmit={addItem}>
        <input type="text" placeholder="Novo item do checklist" value={novoItem} onChange={(e) => setNovoItem(e.target.value)} />
        <button className="btn ghost">Adicionar</button>
      </form>
    </>
  )
}

/* ---------- ALIMENTOS ---------- */

function Alimentos({ sb, avisar }) {
  const [lista, setLista] = useState([])
  const [carregado, setCarregado] = useState(false)
  const [nome, setNome] = useState('')
  const [porcao, setPorcao] = useState('')
  const [prot, setProt] = useState('')

  const carregar = useCallback(async () => {
    const { data } = await sb.from('foods').select('*').order('protein', { ascending: false })
    setLista(data || [])
    setCarregado(true)
  }, [sb])

  useEffect(() => { carregar() }, [carregar])

  async function usar(f) {
    const { error } = await sb.from('meals').insert({ day: hoje(), name: f.name + (f.unit ? ' (' + f.unit + ')' : ''), protein: f.protein })
    if (!error) avisar('+' + fmt(Number(f.protein)) + ' g adicionados em Hoje')
  }

  async function add(e) {
    e.preventDefault()
    if (!nome.trim() || !(num(prot) >= 0)) return
    await sb.from('foods').insert({ name: nome.trim(), unit: porcao.trim(), protein: num(prot) })
    setNome(''); setPorcao(''); setProt(''); carregar()
  }

  async function del(id) {
    await sb.from('foods').delete().eq('id', id)
    carregar()
  }

  async function carregarSugestoes() {
    await sb.from('foods').insert(SUGESTOES)
    carregar()
  }

  return (
    <>
      <h1>Alimentos</h1>
      <p className="sub">Toque em + para somar a proteína no dia de hoje.</p>

      <div className="stack">
        {carregado && lista.length === 0 && (
          <div className="card empty">
            Sua lista está vazia.
            <div style={{ marginTop: 10 }}><button className="btn" onClick={carregarSugestoes}>Carregar 12 sugestões baratas</button></div>
            <div style={{ marginTop: 8, fontSize: 12 }}>Valores aproximados. Confira o rótulo e ajuste se precisar.</div>
          </div>
        )}
        {lista.map((f) => (
          <div key={f.id} className="card item">
            <div className="grow">
              <div className="t">{f.name}</div>
              <div className="s">{f.unit}</div>
            </div>
            <span className="pill">{fmt(Number(f.protein))} g</span>
            <button className="icon-btn add" aria-label={'Somar ' + f.name + ' em hoje'} onClick={() => usar(f)}>+</button>
            <button className="icon-btn" aria-label={'Apagar ' + f.name} onClick={() => del(f.id)}>×</button>
          </div>
        ))}
      </div>

      <h2>Adicionar alimento</h2>
      <form className="stack" onSubmit={add}>
        <input type="text" placeholder="Nome (ex.: Queijo minas)" value={nome} onChange={(e) => setNome(e.target.value)} />
        <div className="form two" style={{ gridTemplateColumns: '1fr 110px' }}>
          <input type="text" placeholder="Porção (ex.: 1 fatia)" value={porcao} onChange={(e) => setPorcao(e.target.value)} />
          <input type="number" inputMode="decimal" step="any" placeholder="g prot." value={prot} onChange={(e) => setProt(e.target.value)} />
        </div>
        <button className="btn ghost" style={{ width: '100%' }}>Adicionar à lista</button>
      </form>
    </>
  )
}

/* ---------- PESO ---------- */

function Peso({ sb }) {
  const [regs, setRegs] = useState([])
  const [kg, setKg] = useState('')
  const [dia, setDia] = useState(hoje())

  const carregar = useCallback(async () => {
    const { data } = await sb.from('weights').select('*').order('day').order('created_at')
    setRegs(data || [])
  }, [sb])

  useEffect(() => { carregar() }, [carregar])

  async function add(e) {
    e.preventDefault()
    if (!(num(kg) > 0)) return
    await sb.from('weights').insert({ day: dia, kg: num(kg) })
    setKg(''); carregar()
  }

  async function del(id) {
    await sb.from('weights').delete().eq('id', id)
    carregar()
  }

  const primeiro = regs[0]
  const ultimo = regs[regs.length - 1]
  const delta = primeiro && ultimo ? Number(ultimo.kg) - Number(primeiro.kg) : 0

  return (
    <>
      <h1>Peso</h1>
      <p className="sub">Pese-se sempre no mesmo horário para comparar melhor.</p>
      <div className="card" style={{ marginBottom: 14, fontSize: 14, lineHeight: 1.5 }}>
        <b>Meta: 60 kg.</b> No ritmo seguro de 0,5 a 0,75 kg por semana, a previsão é por volta de <b>março de 2027</b>. A perda não é linear: olhe a tendência de várias semanas e as medidas.
      </div>

      <form className="form weight" onSubmit={add}>
        <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
        <input type="number" inputMode="decimal" step="any" placeholder="kg" value={kg} onChange={(e) => setKg(e.target.value)} />
        <button className="btn">Salvar</button>
      </form>

      {regs.length >= 2 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <div><b style={{ fontSize: 22 }}>{fmt(Number(ultimo.kg))} kg</b></div>
            <span className="pill">{delta === 0 ? 'Sem variação' : (delta > 0 ? '+' : '') + fmt(delta) + ' kg desde o início'}</span>
          </div>
          <Grafico regs={regs} />
        </div>
      )}

      <h2>Registros</h2>
      <div className="stack">
        {regs.length === 0 && <div className="empty">Registre seu primeiro peso acima.</div>}
        {[...regs].reverse().map((r) => (
          <div key={r.id} className="card item">
            <div className="grow t">{new Date(r.day + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
            <span className="pill">{fmt(Number(r.kg))} kg</span>
            <button className="icon-btn" aria-label="Apagar registro" onClick={() => del(r.id)}>×</button>
          </div>
        ))}
      </div>
    </>
  )
}

function Grafico({ regs }) {
  const W = 300, H = 150, P = 14
  const vals = regs.map((r) => Number(r.kg))
  const min = Math.min(...vals), max = Math.max(...vals)
  const span = max - min || 1
  const pts = vals.map((v, i) => [
    P + (i * (W - 2 * P)) / (vals.length - 1),
    H - P - ((v - min) / span) * (H - 2 * P),
  ])
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de peso ao longo do tempo" preserveAspectRatio="none">
      <path d={d} fill="none" stroke="var(--plum)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="4" fill={i === pts.length - 1 ? 'var(--sun)' : 'var(--plum)'} />)}
    </svg>
  )
}


/* ---------- PLANO DO DIA ---------- */

function PlanoDoDia({ sb, dia }) {
  const dow = new Date().getDay()
  const [agenda, setAgenda] = useState(null)
  const treino = agenda || TREINOS[dow]
  const [feitos, setFeitos] = useState(new Set())
  const [copos, setCopos] = useState(0)
  const [aviso, setAviso] = useState(false)

  const carregar = useCallback(async () => {
    const [pl, ag, sch] = await Promise.all([
      sb.from('plan_done').select('key').eq('day', dia),
      sb.from('water').select('glasses').eq('day', dia).maybeSingle(),
      sb.from('workout_schedule').select('workout_id, workouts(name)').eq('weekday', dow).maybeSingle(),
    ])
    setFeitos(new Set((pl.data || []).map((x) => x.key)))
    setCopos(ag.data ? ag.data.glasses : 0)
    const row = sch.data
    setAgenda(row ? (row.workout_id ? { nome: (row.workouts && row.workouts.name) || 'Treino', musc: true } : { nome: 'Sem musculação (descanso)', musc: false }) : null)
  }, [sb, dia, dow])

  useEffect(() => {
    carregar()
    setAviso(dia >= (localStorage.getItem('reavaliacao') || REAVALIACAO_PADRAO))
  }, [carregar, dia])

  async function marcar(key) {
    if (feitos.has(key)) await sb.from('plan_done').delete().eq('key', key).eq('day', dia)
    else await sb.from('plan_done').insert({ key, day: dia })
    carregar()
  }

  async function mudarCopos(n) {
    const v = Math.max(0, Math.min(20, copos + n))
    setCopos(v)
    await sb.from('water').upsert({ day: dia, glasses: v }, { onConflict: 'user_id,day' })
  }

  const linhas = [
    ...CARDAPIO,
    { k: 'bike', t: 'Bike · 30 min', d: treino.musc ? 'Todo dia' : 'Ritmo leve a moderado' },
    ...(treino.musc ? [{ k: 'treino', t: 'Treino: ' + treino.nome, d: 'Musculação' }] : []),
  ]
  const feitosN = linhas.filter((l) => feitos.has(l.k)).length

  return (
    <>
      {aviso && (
        <div className="card" style={{ marginTop: 14, background: 'var(--plum-soft)', borderColor: 'var(--plum-soft)' }}>
          <b>Dia de atualizar peso e medidas.</b>
          <div className="sub" style={{ margin: '4px 0 0' }}>De manhã, em jejum e fora da menstruação. Registre na aba Medidas.</div>
        </div>
      )}
      <h2>Plano de hoje <span className="pill" style={{ marginLeft: 6 }}>{feitosN} de {linhas.length}</span></h2>
      <div className="stack">
        {linhas.map((l) => {
          const on = feitos.has(l.k)
          return (
            <div key={l.k} className="card item">
              <button className={'check' + (on ? ' on' : '')} aria-label={(on ? 'Desmarcar ' : 'Marcar como feito: ') + l.t} aria-pressed={on} onClick={() => marcar(l.k)}>{on ? '✓' : ''}</button>
              <div className="grow">
                <div className={'t' + (on ? ' done-text' : '')}>{l.t}</div>
                <div className="s">{l.d}</div>
              </div>
            </div>
          )
        })}
        <div className="card item">
          <div className="grow">
            <div className="t">Água</div>
            <div className="s">{copos} de 8 copos (meta: 2 L)</div>
          </div>
          <button className="icon-btn" aria-label="Menos um copo" onClick={() => mudarCopos(-1)}>−</button>
          <button className="icon-btn add" aria-label="Mais um copo" onClick={() => mudarCopos(1)}>+</button>
        </div>
      </div>
    </>
  )
}

/* ---------- MEDIDAS ---------- */

function Medidas({ sb }) {
  const [regs, setRegs] = useState([])
  const [dia, setDia] = useState(hoje())
  const [vals, setVals] = useState({})
  const [proxima, setProxima] = useState(REAVALIACAO_PADRAO)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    const { data } = await sb.from('measurements').select('*').order('day').order('created_at')
    setRegs(data || [])
  }, [sb])

  useEffect(() => {
    setProxima(localStorage.getItem('reavaliacao') || REAVALIACAO_PADRAO)
    carregar()
  }, [carregar])

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    const data = {}
    MEDIDAS.forEach((m) => { const v = num(vals[m.k]); if (vals[m.k] && v > 0) data[m.k] = v })
    if (Object.keys(data).length === 0) return setErro('Preencha pelo menos uma medida.')
    const { error } = await sb.from('measurements').insert({ day: dia, data })
    if (error) return setErro('Não foi possível salvar. Rodou o schema-v2.sql no Supabase?')
    // peso também entra na aba Peso
    if (data.peso) await sb.from('weights').insert({ day: dia, kg: data.peso })
    setVals({})
    carregar()
  }

  async function apagar(id) {
    if (!confirm('Apagar este registro de medidas?')) return
    await sb.from('measurements').delete().eq('id', id)
    carregar()
  }

  function marcarFeita() {
    const d = new Date(proxima + 'T12:00:00')
    const base = new Date()
    base.setHours(12, 0, 0, 0)
    const nova = new Date(Math.max(d.getTime(), base.getTime()))
    nova.setDate(nova.getDate() + 28)
    const s = nova.toLocaleDateString('sv-SE')
    localStorage.setItem('reavaliacao', s)
    setProxima(s)
  }

  function mudarData() {
    const s = prompt('Nova data da próxima atualização (AAAA-MM-DD):', proxima)
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) { localStorage.setItem('reavaliacao', s); setProxima(s) }
  }

  const ultimo = regs[regs.length - 1]
  const dataBonita = (s) => new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <>
      <h1>Medidas</h1>
      <p className="sub">Uma vez por mês, de manhã, em jejum, fora da menstruação, com a fita no mesmo ponto.</p>

      <div className="card row between">
        <div>
          <div className="s" style={{ fontSize: 13, color: 'var(--muted)' }}>Próxima atualização</div>
          <b>{dataBonita(proxima)}</b>
        </div>
        <div className="stack" style={{ textAlign: 'right' }}>
          <button className="btn small ghost" onClick={marcarFeita}>Já fiz</button>
          <div><button className="linkish" onClick={mudarData}>Mudar data</button></div>
        </div>
      </div>

      <h2>Novo registro</h2>
      <form onSubmit={salvar}>
        <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} style={{ marginBottom: 8 }} />
        <div className="grid2">
          {MEDIDAS.map((m) => (
            <label key={m.k} className="campo">
              <span>{m.label}</span>
              <input type="number" inputMode="decimal" step="any" value={vals[m.k] || ''} onChange={(e) => setVals({ ...vals, [m.k]: e.target.value })} />
            </label>
          ))}
        </div>
        {erro && <div className="error" style={{ marginTop: 8 }}>{erro}</div>}
        <button className="btn" style={{ width: '100%', marginTop: 12 }}>Salvar medidas</button>
      </form>

      <h2>Comparação com os 60 kg</h2>
      <div className="card tbl">
        <div className="tr head"><span>Região</span><span>Antes</span><span>Último</span><span>Dif.</span></div>
        {MEDIDAS.map((m) => {
          const regComVal = [...regs].reverse().find((r) => r.data && r.data[m.k] != null)
          const atual = regComVal ? Number(regComVal.data[m.k]) : null
          const dif = atual != null ? atual - m.base : null
          return (
            <div className="tr" key={m.k}>
              <span>{m.label}</span>
              <span>{fmt(m.base)}</span>
              <span>{atual != null ? fmt(atual) : '–'}</span>
              <span>{dif != null ? (dif > 0 ? '+' : '') + fmt(dif) : '–'}</span>
            </div>
          )
        })}
      </div>
      <p className="sub" style={{ marginTop: 8 }}>Com musculação, é possível chegar nas medidas antigas pesando um pouco mais que 60 kg.</p>

      <h2>Registros</h2>
      <div className="stack">
        {regs.length === 0 && <div className="empty">Nenhum registro ainda.</div>}
        {[...regs].reverse().map((r) => (
          <div key={r.id} className="card item">
            <div className="grow t">{dataBonita(r.day)}</div>
            <span className="pill">{Object.keys(r.data || {}).length} medidas</span>
            <button className="icon-btn" aria-label="Apagar registro" onClick={() => apagar(r.id)}>×</button>
          </div>
        ))}
      </div>
    </>
  )
}


/* ---------- TREINOS ---------- */

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const ORDEM_SEMANA = [1, 2, 3, 4, 5, 6, 0]
const novoId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2))
const exVazio = () => ({ id: novoId(), name: '', sets: '', reps: '', notes: '' })
const ex = (name, sets, reps, notes = '') => ({ id: novoId(), name, sets, reps, notes })

// Sugestão inicial, só um ponto de partida: ela pode editar tudo.
const EXEMPLOS = [
  { dia: 1, name: 'Costas + bíceps', exercises: () => [ex('Puxada frontal', '3', '12'), ex('Remada baixa', '3', '12'), ex('Remada curvada', '3', '10'), ex('Rosca direta', '3', '12'), ex('Rosca martelo', '3', '12')] },
  { dia: 2, name: 'Pernas (quadríceps + glúteo)', exercises: () => [ex('Agachamento', '4', '10'), ex('Leg press', '3', '12'), ex('Cadeira extensora', '3', '15'), ex('Afundo', '3', '10', 'Cada perna'), ex('Elevação pélvica', '3', '12')] },
  { dia: 3, name: 'Peito + ombro + tríceps', exercises: () => [ex('Supino reto', '3', '10'), ex('Supino inclinado com halteres', '3', '12'), ex('Desenvolvimento', '3', '12'), ex('Elevação lateral', '3', '15'), ex('Tríceps na corda', '3', '12')] },
  { dia: 4, name: 'Posterior + glúteo', exercises: () => [ex('Stiff', '4', '10'), ex('Mesa flexora', '3', '12'), ex('Cadeira abdutora', '3', '15'), ex('Glúteo na polia', '3', '12'), ex('Elevação pélvica', '3', '12')] },
  { dia: 5, name: 'Costas + bíceps (leve) + abdômen', exercises: () => [ex('Puxada neutra', '3', '12'), ex('Remada unilateral', '3', '12'), ex('Rosca alternada', '3', '12'), ex('Abdominal infra', '3', '15'), ex('Prancha', '3', '30s')] },
]

function Treinos({ sb, avisar }) {
  const dia = hoje()
  const dow = new Date().getDay()
  const [view, setView] = useState('hoje')
  const [diaVer, setDiaVer] = useState(dow)
  const [treinos, setTreinos] = useState([])
  const [agenda, setAgenda] = useState({})
  const [feitos, setFeitos] = useState(new Set())
  const [pronto, setPronto] = useState(false)
  const [semTabelas, setSemTabelas] = useState(false)
  const [edit, setEdit] = useState(null)
  const [offline, setOffline] = useState(false)

  const mostrar = useCallback((treinosLista, agendaLista, feitosLista) => {
    setTreinos(treinosLista)
    const mapa = {}
    agendaLista.forEach((r) => { mapa[r.weekday] = r.workout_id })
    setAgenda(mapa)
    setFeitos(aplicarFila(feitosLista, dia))
    setPronto(true)
  }, [dia])

  const carregar = useCallback(async () => {
    await sincronizar(sb)
    const [w, s, p] = await Promise.all([
      sb.from('workouts').select('*').order('created_at'),
      sb.from('workout_schedule').select('*'),
      sb.from('plan_done').select('key').eq('day', dia),
    ])
    const semRede = [w, s, p].some((r) => erroDeRede(r.error))
    setOffline(semRede)
    if (semRede) {
      const c = lerCacheTreinos()
      if (c) return mostrar(c.treinos, c.agenda, c.dia === dia ? c.feitos : [])
      return mostrar([], [], [])
    }
    setSemTabelas(Boolean(w.error))
    const feitosLista = (p.data || []).map((x) => x.key)
    salvarCacheTreinos({ dia, treinos: w.data || [], agenda: s.data || [], feitos: feitosLista })
    mostrar(w.data || [], s.data || [], feitosLista)
  }, [sb, dia, mostrar])

  useEffect(() => {
    carregar()
    window.addEventListener('online', carregar)
    return () => window.removeEventListener('online', carregar)
  }, [carregar])

  const definido = (d) => Object.prototype.hasOwnProperty.call(agenda, d)
  const treinoDoDia = (d) => (definido(d) && agenda[d] ? treinos.find((t) => t.id === agenda[d]) || null : null)

  // Marca na hora (funciona sem internet) e envia pela fila.
  async function marcarEx(id) {
    const key = 'ex:' + id
    const marcar = !feitos.has(key)
    const novo = new Set(feitos)
    if (marcar) novo.add(key)
    else novo.delete(key)
    setFeitos(novo)
    enfileirar({ marcar, key, day: dia })
    const c = lerCacheTreinos()
    if (c) salvarCacheTreinos({ ...c, dia, feitos: [...novo] })
    await sincronizar(sb)
  }

  async function definirDia(d, val) {
    if (val === 'default') await sb.from('workout_schedule').delete().eq('weekday', d)
    else await sb.from('workout_schedule').upsert({ weekday: d, workout_id: val === 'rest' ? null : val }, { onConflict: 'user_id,weekday' })
    carregar()
  }

  async function carregarExemplos() {
    const linhas = EXEMPLOS.map((e) => ({ name: e.name, notes: 'Sugestão inicial: ajuste exercícios, séries e cargas do seu jeito.', exercises: e.exercises() }))
    const { data, error } = await sb.from('workouts').insert(linhas).select()
    if (error || !data) return avisar('Não foi possível criar os treinos')
    const porNome = Object.fromEntries(data.map((w) => [w.name, w.id]))
    const agendaNova = [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const e = EXEMPLOS.find((x) => x.dia === d)
      return { weekday: d, workout_id: e ? porNome[e.name] : null }
    })
    await sb.from('workout_schedule').upsert(agendaNova, { onConflict: 'user_id,weekday' })
    avisar('Treinos de exemplo criados')
    carregar()
  }

  async function salvar(e) {
    e.preventDefault()
    const name = edit.name.trim()
    if (!name) return
    const exercises = edit.exercises.filter((x) => x.name.trim()).map((x) => ({ ...x, name: x.name.trim() }))
    const payload = { name, notes: edit.notes.trim(), exercises }
    const { error } = edit.id ? await sb.from('workouts').update(payload).eq('id', edit.id) : await sb.from('workouts').insert(payload)
    if (error) return avisar('Não foi possível salvar')
    setEdit(null)
    carregar()
  }

  async function excluir(t) {
    if (!confirm('Excluir "' + t.name + '"? Os dias que usam esse treino voltam a ficar sem definição.')) return
    await sb.from('workouts').delete().eq('id', t.id)
    carregar()
  }

  const setEx = (i, campo, v) => setEdit({ ...edit, exercises: edit.exercises.map((x, j) => (j === i ? { ...x, [campo]: v } : x)) })
  const addEx = () => setEdit({ ...edit, exercises: [...edit.exercises, exVazio()] })
  const delEx = (i) => setEdit({ ...edit, exercises: edit.exercises.filter((_, j) => j !== i) })
  const mover = (i, d) => {
    const a = [...edit.exercises]
    const j = i + d
    if (j < 0 || j >= a.length) return
    ;[a[i], a[j]] = [a[j], a[i]]
    setEdit({ ...edit, exercises: a })
  }

  if (!pronto) return null

  if (semTabelas) {
    return (
      <>
        <h1>Treinos</h1>
        <div className="card empty">Falta criar as tabelas dos treinos. Rode o arquivo <b>schema-v3.sql</b> no SQL Editor do Supabase e abra o app de novo.</div>
      </>
    )
  }

  /* ----- editor ----- */
  if (edit) {
    return (
      <>
        <h1>{edit.id ? 'Editar treino' : 'Novo treino'}</h1>
        <p className="sub">Monte os exercícios com séries, repetições e observações.</p>
        <form className="stack" onSubmit={salvar}>
          <input type="text" placeholder="Nome do treino (ex.: Pernas e glúteo)" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required />
          <input type="text" placeholder="Observação do treino (opcional)" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />

          <h2>Exercícios</h2>
          <div className="grid-auto">
            {edit.exercises.map((x, i) => (
              <div key={x.id} className="card ex-edit">
                <div className="row between" style={{ marginBottom: 8 }}>
                  <span className="pill">{i + 1}</span>
                  <span>
                    <button type="button" className="icon-btn" aria-label="Subir" onClick={() => mover(i, -1)} disabled={i === 0}>↑</button>
                    <button type="button" className="icon-btn" aria-label="Descer" onClick={() => mover(i, 1)} disabled={i === edit.exercises.length - 1}>↓</button>
                    <button type="button" className="icon-btn" aria-label="Remover exercício" onClick={() => delEx(i)}>×</button>
                  </span>
                </div>
                <div className="ex-fields">
                  <input className="span2" type="text" placeholder="Exercício" value={x.name} onChange={(e) => setEx(i, 'name', e.target.value)} />
                  <label className="campo"><span>Séries</span><input type="text" inputMode="numeric" value={x.sets} onChange={(e) => setEx(i, 'sets', e.target.value)} /></label>
                  <label className="campo"><span>Repetições</span><input type="text" placeholder="12 ou 10-12" value={x.reps} onChange={(e) => setEx(i, 'reps', e.target.value)} /></label>
                  <input className="span2" type="text" placeholder="Observação (carga, descanso...)" value={x.notes} onChange={(e) => setEx(i, 'notes', e.target.value)} />
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="btn ghost" onClick={addEx}>+ Adicionar exercício</button>

          <div className="row" style={{ marginTop: 6 }}>
            <button type="button" className="btn ghost grow" onClick={() => setEdit(null)}>Cancelar</button>
            <button className="btn grow">Salvar treino</button>
          </div>
        </form>
      </>
    )
  }

  const novoTreino = () => setEdit({ name: '', notes: '', exercises: [exVazio()] })
  const editar = (t) => setEdit({ id: t.id, name: t.name, notes: t.notes || '', exercises: (t.exercises || []).map((x) => ({ ...x })) })

  const verTreino = treinoDoDia(diaVer)
  const verDefinido = definido(diaVer)
  const eHoje = diaVer === dow
  const exs = verTreino ? verTreino.exercises || [] : []
  const feitosN = exs.filter((x) => feitos.has('ex:' + x.id)).length

  return (
    <>
      <h1>Treinos</h1>
      <p className="sub">Seus treinos da semana, do jeito que você quiser.</p>
      {offline && (
        <div className="card" style={{ marginBottom: 14, background: 'var(--plum-soft)', borderColor: 'var(--plum-soft)', fontSize: 14 }}>
          <b>Sem internet.</b> Mostrando a última cópia salva. Pode marcar os exercícios: eles são enviados quando a conexão voltar.
        </div>
      )}

      <div className="seg" role="tablist">
        {[['hoje', 'Treino do dia'], ['semana', 'Semana'], ['treinos', 'Meus treinos']].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{label}</button>
        ))}
      </div>

      {/* ----- TREINO DO DIA ----- */}
      {view === 'hoje' && (
        <>
          <div className="chips" style={{ marginTop: 14 }}>
            {ORDEM_SEMANA.map((d) => (
              <button key={d} className={'chip' + (diaVer === d ? ' on' : '') + (d === dow ? ' hoje' : '')} onClick={() => setDiaVer(d)} aria-label={DIAS[d]}>{DIAS[d].slice(0, 3)}</button>
            ))}
          </div>

          {treinos.length === 0 && (
            <div className="card empty" style={{ marginTop: 10 }}>
              Você ainda não tem treinos cadastrados.
              <div className="row" style={{ justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn" onClick={novoTreino}>Criar meu primeiro treino</button>
                <button className="btn ghost" onClick={carregarExemplos}>Usar treinos de exemplo</button>
              </div>
            </div>
          )}

          {treinos.length > 0 && verDefinido && !verTreino && (
            <div className="hero-treino" style={{ marginTop: 10 }}>
              <h2>Dia de descanso</h2>
              <p className="sub" style={{ margin: '6px 0 0' }}>{DIAS[diaVer]} sem musculação. Hidrate-se e, se quiser, faça uma caminhada leve.</p>
            </div>
          )}

          {treinos.length > 0 && !verDefinido && (
            <div className="hero-treino" style={{ marginTop: 10 }}>
              <h2>Nenhum treino definido</h2>
              <p className="sub" style={{ margin: '6px 0 10px' }}>Escolha o treino de {DIAS[diaVer].toLowerCase()} na aba Semana.</p>
              <button className="btn small" onClick={() => setView('semana')}>Definir agora</button>
            </div>
          )}

          {verTreino && (
            <>
              <div className="hero-treino" style={{ marginTop: 10 }}>
                <div className="row between">
                  <div className="s" style={{ fontSize: 13, color: 'var(--muted)' }}>{eHoje ? 'Hoje' : DIAS[diaVer]} · {exs.length} {exs.length === 1 ? 'exercício' : 'exercícios'}</div>
                  {eHoje && exs.length > 0 && <span className="pill">{feitosN} de {exs.length}</span>}
                </div>
                <h2 style={{ fontSize: 22, margin: '4px 0 0' }}>{verTreino.name}</h2>
                {verTreino.notes && <p className="sub" style={{ margin: '6px 0 0' }}>{verTreino.notes}</p>}
              </div>
              <div className="grid-auto" style={{ marginTop: 10 }}>
                {exs.length === 0 && <div className="empty">Este treino ainda não tem exercícios. Adicione em Meus treinos.</div>}
                {exs.map((x) => {
                  const on = feitos.has('ex:' + x.id)
                  return (
                    <div key={x.id} className="card item ex-card">
                      {eHoje ? (
                        <button className={'check' + (on ? ' on' : '')} aria-pressed={on} aria-label={(on ? 'Desmarcar ' : 'Marcar como feito: ') + x.name} onClick={() => marcarEx(x.id)}>{on ? '✓' : ''}</button>
                      ) : null}
                      <div className="grow">
                        <div className={'t' + (on ? ' done-text' : '')}>{x.name}</div>
                        {x.notes && <div className="ex-notes">{x.notes}</div>}
                      </div>
                      <span className="pill">{x.sets || '–'} × {x.reps || '–'}</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ----- SEMANA ----- */}
      {view === 'semana' && (
        <>
          <h2>Treino de cada dia</h2>
          {treinos.length === 0 && <div className="card empty">Crie ao menos um treino em Meus treinos para poder escolher aqui.</div>}
          <div className="grid-auto">
            {ORDEM_SEMANA.map((d) => {
              const valor = definido(d) ? (agenda[d] ? agenda[d] : 'rest') : 'default'
              return (
                <div key={d} className="card day-row">
                  <div className="row between" style={{ marginBottom: 8 }}>
                    <b>{DIAS[d]}</b>
                    {d === dow && <span className="pill">Hoje</span>}
                  </div>
                  <select value={valor} onChange={(e) => definirDia(d, e.target.value)} aria-label={'Treino de ' + DIAS[d]}>
                    <option value="default">Sem definir</option>
                    <option value="rest">Descanso</option>
                    {treinos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ----- MEUS TREINOS ----- */}
      {view === 'treinos' && (
        <>
          <div className="row between" style={{ margin: '18px 0 10px' }}>
            <h2 style={{ margin: 0 }}>Meus treinos</h2>
            <button className="btn small" onClick={novoTreino}>+ Novo treino</button>
          </div>
          {treinos.length === 0 && (
            <div className="card empty">
              Nenhum treino cadastrado.
              <div style={{ marginTop: 12 }}><button className="btn ghost" onClick={carregarExemplos}>Usar treinos de exemplo</button></div>
            </div>
          )}
          <div className="grid-auto">
            {treinos.map((t) => {
              const lista = t.exercises || []
              return (
                <div key={t.id} className="card item ex-card">
                  <div className="grow">
                    <div className="t"><b>{t.name}</b></div>
                    <div className="s">{lista.length} {lista.length === 1 ? 'exercício' : 'exercícios'}{lista.length ? ' · ' + lista.slice(0, 3).map((x) => x.name).join(', ') + (lista.length > 3 ? '…' : '') : ''}</div>
                  </div>
                  <button className="btn small ghost" onClick={() => editar(t)}>Editar</button>
                  <button className="icon-btn" aria-label={'Excluir ' + t.name} onClick={() => excluir(t)}>×</button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
