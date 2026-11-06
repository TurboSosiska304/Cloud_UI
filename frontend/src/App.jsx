import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
} from '@xyflow/react'
import { ConfigCtx, api } from './state.js'
import { nodeTypes, NODE_DEFAULTS } from './nodes.jsx'

const uid = () => Math.random().toString(36).slice(2, 10)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

const DEFAULT_SETTINGS = {
  auto_fit: true,
  modules: {
    diffusion: { compute: 'auto', params: 'auto' },
    te: { compute: 'auto', params: 'auto' },
    vae: { compute: 'auto', params: 'auto' },
  },
}

/* ---------------- templates ---------------- */
const edge = (s, t, sh, th) => ({ id: `e_${s}_${t}_${th}`, source: s, target: t, sourceHandle: sh, targetHandle: th, type: 'smoothstep' })

function templateTxt2img(preset = 'flux2-4b', steps = 4, cfg = 1) {
  return {
    nodes: [
      { id: 'm1', type: 'model', position: { x: 30, y: 60 }, data: { preset } },
      { id: 'p1', type: 'prompt', position: { x: 30, y: 260 }, data: { positive: 'cinematic photo of a red fox in a snowy forest at golden hour, detailed fur' } },
      { id: 's1', type: 'image_sampler', position: { x: 340, y: 120 }, data: { width: 1024, height: 1024, steps, cfg, seed: 42, batch: 1, sampler: 'euler' } },
      { id: 'o1', type: 'save', position: { x: 830, y: 170 }, data: { name: 'final' } },
    ],
    edges: [edge('m1', 's1', 'model', 'model'), edge('p1', 's1', 'prompt', 'prompt'), edge('s1', 'o1', 'image', 'image')],
  }
}

function templateEdit() {
  return {
    nodes: [
      { id: 'm1', type: 'model', position: { x: 20, y: 40 }, data: { preset: 'flux3' } },
      { id: 'i1', type: 'load_image', position: { x: 20, y: 230 }, data: { path: '' } },
      { id: 'p1', type: 'prompt', position: { x: 20, y: 470 }, data: { positive: 'change the color grading to warm golden hour, keep composition unchanged' } },
      { id: 's1', type: 'image_ref_sampler', position: { x: 350, y: 120 }, data: { width: 896, height: 1152, steps: 16, cfg: 1, seed: 42, batch: 1, sampler: 'euler', strength: 0.6 } },
      { id: 'o1', type: 'save', position: { x: 860, y: 170 }, data: { name: 'edit' } },
    ],
    edges: [edge('m1', 's1', 'model', 'model'), edge('p1', 's1', 'prompt', 'prompt'),
      edge('i1', 's1', 'image', 'image'), edge('s1', 'o1', 'image', 'image')],
  }
}

function templateWan() {
  return {
    nodes: [
      { id: 'm1', type: 'model', position: { x: 20, y: 40 }, data: { preset: 'wan' } },
      { id: 'p1', type: 'prompt', position: { x: 20, y: 230 }, data: { positive: 'a red fox walking through a snowy pine forest, cinematic' } },
      { id: 's1', type: 'wan_sampler', position: { x: 340, y: 100 }, data: { width: 640, height: 352, steps: 20, cfg: 6, seed: 42, frames: 33, fps: 16, flow_shift: 3, sampler: 'euler' } },
      { id: 'o1', type: 'save', position: { x: 860, y: 160 }, data: { name: 'video' } },
    ],
    edges: [edge('m1', 's1', 'model', 'model'), edge('p1', 's1', 'prompt', 'prompt'), edge('s1', 'o1', 'image', 'image')],
  }
}

function templateUpscale() {
  return {
    nodes: [
      { id: 'i1', type: 'load_image', position: { x: 40, y: 120 }, data: { path: '' } },
      { id: 'u1', type: 'upscale', position: { x: 350, y: 120 }, data: { model: 'RealESRGAN_x4plus', repeats: 1 } },
      { id: 'o1', type: 'save', position: { x: 660, y: 140 }, data: { name: 'upscaled' } },
    ],
    edges: [edge('i1', 'u1', 'image', 'image'), edge('u1', 'o1', 'image', 'image')],
  }
}

const TEMPLATES = {
  txt2img: () => templateTxt2img('flux2-4b', 4, 1),
  quality: () => templateTxt2img('flux3', 16, 1),
  edit: templateEdit,
  wan: templateWan,
  upscale: templateUpscale,
}

/* ---------------- app ---------------- */
export default function App() {
  const [config, setConfig] = useState({ models: {}, text_encoders: {}, vaes: {}, upscalers: [] })
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)
  const [nodes, setNodes, onNodesChange] = useNodesState(TEMPLATES.txt2img().nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(TEMPLATES.txt2img().edges)
  const [job, setJob] = useState(null)
  const [jobId, setJobId] = useState(null)
  const [logs, setLogs] = useState([])
  const [showLog, setShowLog] = useState(false)
  const [workflows, setWorkflows] = useState([])
  const [gallery, setGallery] = useState([])
  const [showGallery, setShowGallery] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('untitled')
  const [menu, setMenu] = useState(null)
  const logNext = useRef(0)
  const logRef = useRef(null)

  useEffect(() => {
    api('/api/config').then((c) => {
      setConfig(c)
      if (c.defaults) setSettings({ ...DEFAULT_SETTINGS, ...c.defaults })
    }).catch((e) => setError(String(e)))
    refreshWorkflows()
  }, [])

  useEffect(() => {
    if (!jobId) return
    let stop = false
    const tick = async () => {
      try {
        const j = await api(`/api/jobs/${jobId}`)
        if (stop) return
        setJob(j)
        const l = await api(`/api/jobs/${jobId}/log?since=${logNext.current}`)
        if (l.lines?.length) {
          logNext.current = l.next
          setLogs((prev) => [...prev, ...l.lines].slice(-5000))
        }
        if (['done', 'error', 'cancelled'].includes(j.status)) {
          setJobId(null)
          refreshGallery()
        }
      } catch (e) { setError(String(e)) }
    }
    tick()
    const t = setInterval(tick, 1200)
    return () => { stop = true; clearInterval(t) }
  }, [jobId])

  useEffect(() => {
    if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs, showLog])

  const refreshWorkflows = () => api('/api/workflows').then(setWorkflows).catch(() => {})
  const refreshGallery = () => api('/api/outputs').then(setGallery).catch(() => {})

  const onConnect = useCallback((c) => setEdges((es) => addEdge({
    ...c, type: 'smoothstep', style: { stroke: '#7c8aa5', strokeWidth: 2 },
  }, es)), [setEdges])

  const addNode = (type) => {
    const pos = { x: 260 + Math.random() * 240, y: 100 + Math.random() * 300 }
    setNodes((ns) => [...ns, { id: uid(), type, position: pos, data: { ...(NODE_DEFAULTS[type] || {}) } }])
  }

  const graph = () => ({
    settings,
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle })),
  })

  const run = async () => {
    setError('')
    try {
      const j = await api('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: graph(), name }),
      })
      setJob(j); setLogs([]); logNext.current = 0; setJobId(j.id)
    } catch (e) { setError(String(e)) }
  }

  const cancel = async () => {
    if (job?.id) await api(`/api/jobs/${job.id}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).catch(() => {})
  }

  const saveWorkflow = async () => {
    const n = window.prompt('Workflow name', name)?.trim()
    if (!n) return
    await api(`/api/workflows/${encodeURIComponent(n)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(graph()),
    }).then(() => { setName(n); refreshWorkflows() }).catch((e) => setError(String(e)))
  }

  const loadWorkflow = async (n) => {
    try {
      const g = await api(`/api/workflows/${encodeURIComponent(n)}`)
      setNodes(g.nodes || []); setEdges(g.edges || [])
      if (g.settings) setSettings({ ...DEFAULT_SETTINGS, ...g.settings })
      setName(n)
    } catch (e) { setError(String(e)) }
  }

  const applyTemplate = (t) => {
    const g = TEMPLATES[t]()
    setNodes(g.nodes); setEdges(g.edges); setName(t)
  }

  const deleteNode = (id) => {
    setNodes((ns) => ns.filter((n) => n.id !== id))
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id))
    setMenu(null)
  }

  const duplicateNode = (id) => {
    const n = nodes.find((x) => x.id === id)
    if (!n) return
    setNodes((ns) => [...ns, {
      ...n, id: uid(), selected: false,
      position: { x: n.position.x + 40, y: n.position.y + 40 },
      data: JSON.parse(JSON.stringify(n.data)),
    }])
    setMenu(null)
  }

  const useAsInput = (path) => {
    const abs = `/home/nik/Projects/opencode/sd_cpp_/Cloud_UI/outputs/${path}`
    setNodes((ns) => [...ns, { id: uid(), type: 'load_image', position: { x: 60, y: 620 }, data: { path: abs } }])
    setShowGallery(false)
  }

  const outputs = job?.outputs || []

  return (
    <ConfigCtx.Provider value={config}>
      <div className="app">
        <header className="topbar">
          <div className="brand">Cloud_UI <span>sd.cpp</span></div>
          <input className="wfname" value={name} onChange={(e) => setName(e.target.value)} />
          <button onClick={run} disabled={!!jobId} className="primary">{jobId ? 'Running…' : '▶ Run'}</button>
          <button onClick={cancel} disabled={!jobId}>■ Stop</button>
          <button onClick={saveWorkflow}>Save</button>
          <select className="wfsel" value="" onChange={(e) => e.target.value && loadWorkflow(e.target.value)}>
            <option value="">Load workflow…</option>
            {workflows.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
          </select>
          <button onClick={() => setShowSettings(true)} title="Settings">⚙ Settings</button>
          <button onClick={() => { setShowGallery(true); refreshGallery() }}>Gallery</button>
          <div className="status">
            {job ? `${job.status} ${job.progress_text || ''}` : 'idle'}
            {job && <div className="bar"><i style={{ width: `${(job.progress || 0) * 100}%` }} /></div>}
          </div>
        </header>

        <div className="rail" onClick={() => setShowLog(!showLog)} title="Toggle log">
          <div className="rail-icon">▣</div>
          <div className="rail-text">LOG</div>
        </div>

        <aside className="palette">
          <div className="ptitle">Nodes</div>
          {[
            ['model', 'Model'], ['te', 'Text Encoder'], ['vae', 'VAE'], ['prompt', 'Prompt'],
            ['image_sampler', 'Image Sampler'], ['image_ref_sampler', 'Image Sampler (ref)'],
            ['wan_sampler', 'Wan Sampler'], ['load_image', 'Load Image'],
            ['upscale', 'Upscale'], ['save', 'Save'],
          ].map(([t, label]) => <button key={t} onClick={() => addNode(t)}>+ {label}</button>)}
          <div className="ptitle">Templates</div>
          <button onClick={() => applyTemplate('txt2img')}>Txt2Img (fast)</button>
          <button onClick={() => applyTemplate('quality')}>Txt2Img (FLUX.3)</button>
          <button onClick={() => applyTemplate('edit')}>Edit (reference)</button>
          <button onClick={() => applyTemplate('wan')}>Wan video</button>
          <button onClick={() => applyTemplate('upscale')}>Upscale</button>
          {error && <div className="error">{error}</div>}
        </aside>

        <main className="canvas">
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} fitView minZoom={0.1} maxZoom={2}
            onNodeContextMenu={(ev, node) => {
              ev.preventDefault()
              setMenu({ x: ev.clientX, y: ev.clientY, id: node.id })
            }}
            onPaneClick={() => setMenu(null)}
            onMoveStart={() => setMenu(null)}
            defaultEdgeOptions={{ type: 'smoothstep' }}
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background color="#2a3242" gap={24} />
            <MiniMap pannable zoomable nodeColor="#39435a" maskColor="#0b0f16cc" />
            <Controls />
          </ReactFlow>
          {menu && (
            <div className="ctx" style={{ left: menu.x, top: menu.y }}>
              <button onClick={() => duplicateNode(menu.id)}>Duplicate</button>
              <button className="danger" onClick={() => deleteNode(menu.id)}>Delete node</button>
            </div>
          )}
        </main>

        {showLog && (
          <section className="logpanel">
            <div className="loghead">
              <b>LOG</b>
              <span className="muted">{job ? `${job.status} · ${job.progress_text || ''}` : 'idle'}</span>
              <button onClick={() => setShowLog(false)}>✕</button>
            </div>
            <pre className="log" ref={logRef}>{logs.join('\n') || '— пока пусто —'}</pre>
          </section>
        )}

        <aside className="side">
          <div className="ptitle">Job</div>
          <div className="jobmeta">{job ? <><b>{job.status}</b> · {job.progress_text || '—'}</> : 'no job yet'}</div>
          <div className="outputs">
            {outputs.map((o) => {
              const url = `/files/${o.split('/').map(encodeURIComponent).join('/')}`
              const isVideo = /\.(mp4|webm)$/i.test(o)
              return isVideo
                ? <video key={o} src={url} controls />
                : <img key={o} src={url} alt={o} />
            })}
          </div>
          <div className="hint" style={{ padding: '0 10px' }}>правый клик по ноде → Delete</div>
        </aside>
      </div>

      {showSettings && (
        <div className="modal-back" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><b>Placement settings</b><button onClick={() => setShowSettings(false)}>✕</button></div>
            <label className="check">
              <input type="checkbox" checked={settings.auto_fit}
                onChange={(e) => setSettings({ ...settings, auto_fit: e.target.checked })} />
              Auto-fit (sd.cpp сам решает, что держать в VRAM/RAM)
            </label>
            <table className="settings">
              <thead><tr><th>Module</th><th>Compute</th><th>Weights</th></tr></thead>
              <tbody>
                {['diffusion', 'te', 'vae'].map((mod) => (
                  <tr key={mod}>
                    <td>{mod}</td>
                    <td>
                      <select disabled={settings.auto_fit}
                        value={settings.modules[mod]?.compute || 'auto'}
                        onChange={(e) => setSettings({
                          ...settings,
                          modules: { ...settings.modules, [mod]: { ...settings.modules[mod], compute: e.target.value } },
                        })}>
                        <option value="auto">auto</option>
                        <option value="vulkan0">GPU (vulkan0)</option>
                        <option value="cpu">CPU</option>
                      </select>
                    </td>
                    <td>
                      <select disabled={settings.auto_fit}
                        value={settings.modules[mod]?.params || 'auto'}
                        onChange={(e) => setSettings({
                          ...settings,
                          modules: { ...settings.modules, [mod]: { ...settings.modules[mod], params: e.target.value } },
                        })}>
                        <option value="auto">auto</option>
                        <option value="vulkan0">VRAM (GPU)</option>
                        <option value="cpu">RAM (CPU)</option>
                        <option value="disk">Disk</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint">Weights=RAM + Compute=GPU — это «держать в RAM и подгружать на GPU».<br />
              Для FLUX.3/9B обычно: te = RAM→GPU, vae = RAM→GPU, diffusion = VRAM.</div>
            <div className="modal-actions">
              <button onClick={() => setSettings(DEFAULT_SETTINGS)}>Reset</button>
              <button className="primary" onClick={() => setShowSettings(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {showGallery && (
        <div className="modal-back" onClick={() => setShowGallery(false)}>
          <div className="gallery-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <b>Gallery</b>
              <button onClick={refreshGallery}>↻ Refresh</button>
              <button onClick={() => setShowGallery(false)}>✕</button>
            </div>
            <div className="gallery">
              {gallery.length === 0 && <div className="hint">пока нет результатов</div>}
              {gallery.map((f) => {
                const url = `/files/${f.path.split('/').map(encodeURIComponent).join('/')}`
                const isVideo = /\.(mp4|webm)$/i.test(f.path)
                return (
                  <div className="card" key={f.path}>
                    <a href={url} target="_blank" rel="noreferrer">
                      {isVideo ? <video src={url} muted /> : <img src={url} alt={f.path} />}
                    </a>
                    <div className="card-meta">
                      <span title={f.path}>{f.path}</span>
                      <span>{(f.size / 1048576).toFixed(1)} MB</span>
                    </div>
                    <div className="card-actions">
                      <a href={url} target="_blank" rel="noreferrer">Open</a>
                      <button onClick={() => useAsInput(f.path)}>Use as input</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </ConfigCtx.Provider>
  )
}
