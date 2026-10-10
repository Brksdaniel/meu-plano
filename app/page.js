'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'

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

export default function Page() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const sb = getSupabase()
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!ready) return null
  return session ? <App /> : <Auth />
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

  return (
    <>
      <div className="shell">
        {aba === 'hoje' && <Hoje sb={sb} />}
        {aba === 'alimentos' && <Alimentos sb={sb} avisar={avisar} />}
        {aba === 'peso' && <Peso sb={sb} />}
        <button className="linkish" style={{ marginTop: 28 }} onClick={() => sb.auth.signOut()}>Sair da conta</button>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
      <nav className="tabs">
        {[['hoje', 'Hoje'], ['alimentos', 'Alimentos'], ['peso', 'Peso']].map(([k, label]) => (
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