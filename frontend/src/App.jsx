import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position,
  useNodesState, useEdgesState, addEdge, useReactFlow,
} from '@xyflow/react'

const ConfigCtx = createContext({ models: {}, upscalers: [] })

async function api(path, opts) {
  const res = await fetch(path, opts)
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { error: text } }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

const uid = () => Math.random().toString(36).slice(2, 10)

/* ---------------- node shell ---------------- */
function Shell({ title, accent, children, inputs = [], outputs = [] }) {
  return (
    <div className="node" style={{ '--accent': accent }}>
      <div className="node-head">{title}</div>
      <div className="node-body">{children}</div>
      {inputs.map((h, i) => (
        <Handle key={h.id} id={h.id} type="target" position={Position.Left}
          className="port" style={{ top: 34 + i * 22 }} />
      ))}
      {outputs.map((h, i) => (
        <Handle key={h.id} id={h.id} type="source" position={Position.Right}
          className="port" style={{ top: 34 + i * 22 }} />
      ))}
    </div>
  )
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

/* ---------------- nodes ---------------- */
function ModelNode({ id, data }) {
  const { models } = useContext(ConfigCtx)
  const { updateNodeData } = useReactFlow()
  const m = models[data.preset] || {}
  return (
    <Shell title="Model" accent="#6ea8fe" outputs={[{ id: 'model' }]}>
      <Field label="Preset">
        <select value={data.preset || 'flux2-4b'}
          onChange={(e) => updateNodeData(id, { preset: e.target.value })}>
          {Object.entries(models).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </Field>
      <div className="hint">{m.family} · {m.steps} steps · cfg {m.cfg}</div>
    </Shell>
  )
}

function PromptNode({ id, data }) {
  const { updateNodeData } = useReactFlow()
  const [showNeg, setShowNeg] = useState(false)
  return (
    <Shell title="Prompt" accent="#c792ea" outputs={[{ id: 'prompt' }]}>
      <textarea rows={4} placeholder="positive prompt"
        value={data.positive || ''}
        onChange={(e) => updateNodeData(id, { positive: e.target.value })} />
      <button className="link" onClick={() => setShowNeg(!showNeg)}>
        {showNeg ? '− negative' : '+ negative'}
      </button>
      {showNeg && (
        <textarea rows={3} placeholder="negative prompt"
          value={data.negative || ''}
          onChange={(e) => updateNodeData(id, { negative: e.target.value })} />
      )}
    </Shell>
  )
}

function SamplerNode({ id, data }) {
  const { updateNodeData } = useReactFlow()
  const set = (k, v) => updateNodeData(id, { [k]: v })
  return (
    <Shell title="Sampler" accent="#ffcb6b"
      inputs={[{ id: 'model' }, { id: 'prompt' }, { id: 'image' }]}
      outputs={[{ id: 'image' }]}>
      <div className="row">
        <Field label="W"><input type="number" step="16" value={data.width ?? 1024}
          onChange={(e) => set('width', +e.target.value)} /></Field>
        <Field label="H"><input type="number" step="16" value={data.height ?? 1024}
          onChange={(e) => set('height', +e.target.value)} /></Field>
      </div>
      <div className="row">
        <Field label="Steps"><input type="number" min="1" max="60" value={data.steps ?? 4}
          onChange={(e) => set('steps', +e.target.value)} /></Field>
        <Field label="CFG"><input type="number" step="0.1" value={data.cfg ?? 1}
          onChange={(e) => set('cfg', +e.target.value)} /></Field>
      </div>
      <div className="row">
        <Field label="Seed"><input type="number" value={data.seed ?? 42}
          onChange={(e) => set('seed', +e.target.value)} /></Field>
        <Field label="Batch"><input type="number" min="1" max="8" value={data.batch ?? 1}
          onChange={(e) => set('batch', +e.target.value)} /></Field>
      </div>
      <Field label="Sampler">
        <select value={data.sampler || 'euler'} onChange={(e) => set('sampler', e.target.value)}>
          <option>euler</option><option>euler_a</option><option>heun</option>
          <option>dpm++2m</option><option>dpm++2mv2</option><option>lcm</option>
        </select>
      </Field>
      <div className="row">
        <Field label="Frames (Wan)"><input type="number" value={data.frames ?? 33}
          onChange={(e) => set('frames', +e.target.value)} /></Field>
        <Field label="FPS"><input type="number" value={data.fps ?? 16}
          onChange={(e) => set('fps', +e.target.value)} /></Field>
      </div>
      <Field label="Ref strength (img2img)">
        <input type="number" step="0.05" min="0" max="1" value={data.strength ?? 0.6}
          onChange={(e) => set('strength', +e.target.value)} />
      </Field>
      <div className="hint">image input = reference/edit or img2img</div>
    </Shell>
  )
}

function LoadImageNode({ id, data }) {
  const { updateNodeData } = useReactFlow()
  const fileRef = useRef(null)
  const upload = async (file) => {
    const b64 = await new Promise((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result).split(',')[1])
      r.readAsDataURL(file)
    })
    const res = await api('/api/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, data: b64 }),
    })
    updateNodeData(id, { path: res.path })
  }
  const src = data.path ? `/api/image?path=${encodeURIComponent(data.path)}` : ''
  return (
    <Shell title="Load Image" accent="#89ddff" outputs={[{ id: 'image' }]}>
      <input className="path" placeholder="/path/to/image.png"
        value={data.path || ''} onChange={(e) => updateNodeData(id, { path: e.target.value })} />
      <button onClick={() => fileRef.current?.click()}>Upload…</button>
      <input ref={fileRef} type="file" accept="image/*" hidden
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      {src && <img className="thumb" src={src} alt="" />}
    </Shell>
  )
}

function UpscaleNode({ id, data }) {
  const { upscalers } = useContext(ConfigCtx)
  const { updateNodeData } = useReactFlow()
  return (
    <Shell title="Upscale" accent="#c3e88d" inputs={[{ id: 'image' }]} outputs={[{ id: 'image' }]}>
      <Field label="Model">
        <select value={data.model || upscalers[0] || ''}
          onChange={(e) => updateNodeData(id, { model: e.target.value })}>
          {upscalers.map((u) => <option key={u}>{u}</option>)}
        </select>
      </Field>
      <Field label="Repeats">
        <input type="number" min="1" max="4" value={data.repeats ?? 1}
          onChange={(e) => updateNodeData(id, { repeats: +e.target.value })} />
      </Field>
    </Shell>
  )
}

function SaveNode({ id, data }) {
  const { updateNodeData } = useReactFlow()
  return (
    <Shell title="Save / Output" accent="#f78c6c" inputs={[{ id: 'image' }]}>
      <Field label="Name (optional)">
        <input value={data.name || ''} placeholder="final"
          onChange={(e) => updateNodeData(id, { name: e.target.value })} />
      </Field>
    </Shell>
  )
}

const nodeTypes = {
  model: ModelNode, prompt: PromptNode, sampler: SamplerNode,
  load_image: LoadImageNode, upscale: UpscaleNode, save: SaveNode,
}

/* ---------------- templates ---------------- */
function baseNodes(preset = 'flux2-4b', steps = 4, cfg = 1) {
  return [
    { id: 'm1', type: 'model', position: { x: 40, y: 120 }, data: { preset } },
    { id: 'p1', type: 'prompt', position: { x: 40, y: 300 }, data: { positive: 'cinematic photo of a red fox in a snowy forest at golden hour, detailed fur' } },
    { id: 's1', type: 'sampler', position: { x: 330, y: 150 }, data: { width: 1024, height: 1024, steps, cfg, seed: 42, batch: 1, sampler: 'euler', strength: 0.6 } },
    { id: 'o1', type: 'save', position: { x: 710, y: 200 }, data: { name: 'final' } },
  ]
}
const baseEdges = [
  { id: 'e1', source: 'm1', target: 's1', sourceHandle: 'model', targetHandle: 'model' },
  { id: 'e2', source: 'p1', target: 's1', sourceHandle: 'prompt', targetHandle: 'prompt' },
  { id: 'e3', source: 's1', target: 'o1', sourceHandle: 'image', targetHandle: 'image' },
]

const templates = {
  txt2img: () => ({ nodes: baseNodes('flux2-4b', 4, 1), edges: baseEdges }),
  quality: () => ({ nodes: baseNodes('flux3', 16, 1), edges: baseEdges }),
  edit: () => ({
    nodes: [
      { id: 'm1', type: 'model', position: { x: 30, y: 60 }, data: { preset: 'flux3' } },
      { id: 'i1', type: 'load_image', position: { x: 30, y: 250 }, data: { path: '' } },
      { id: 'p1', type: 'prompt', position: { x: 30, y: 500 }, data: { positive: 'change the color grading to warm golden hour, keep composition unchanged' } },
      { id: 's1', type: 'sampler', position: { x: 340, y: 150 }, data: { width: 896, height: 1152, steps: 16, cfg: 1, seed: 42, batch: 1, sampler: 'euler', strength: 0.6 } },
      { id: 'o1', type: 'save', position: { x: 720, y: 220 }, data: { name: 'edit' } },
    ],
    edges: [
      { id: 'e1', source: 'm1', target: 's1', sourceHandle: 'model', targetHandle: 'model' },
      { id: 'e2', source: 'p1', target: 's1', sourceHandle: 'prompt', targetHandle: 'prompt' },
      { id: 'e3', source: 'i1', target: 's1', sourceHandle: 'image', targetHandle: 'image' },
      { id: 'e4', source: 's1', target: 'o1', sourceHandle: 'image', targetHandle: 'image' },
    ],
  }),
  upscale: () => ({
    nodes: [
      { id: 'i1', type: 'load_image', position: { x: 40, y: 160 }, data: { path: '' } },
      { id: 'u1', type: 'upscale', position: { x: 340, y: 160 }, data: { model: 'RealESRGAN_x4plus', repeats: 1 } },
      { id: 'o1', type: 'save', position: { x: 650, y: 180 }, data: { name: 'upscaled' } },
    ],
    edges: [
      { id: 'e1', source: 'i1', target: 'u1', sourceHandle: 'image', targetHandle: 'image' },
      { id: 'e2', source: 'u1', target: 'o1', sourceHandle: 'image', targetHandle: 'image' },
    ],
  }),
}

/* ---------------- app ---------------- */
export default function App() {
  const [config, setConfig] = useState({ models: {}, upscalers: [] })
  const [nodes, setNodes, onNodesChange] = useNodesState(templates.txt2img().nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(templates.txt2img().edges)
  const [job, setJob] = useState(null)
  const [jobId, setJobId] = useState(null)
  const [logs, setLogs] = useState([])
  const [workflows, setWorkflows] = useState([])
  const [gallery, setGallery] = useState([])
  const [showGallery, setShowGallery] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('untitled')
  const logRef = useRef(null)

  useEffect(() => {
    api('/api/config').then(setConfig).catch((e) => setError(String(e)))
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
        setLogs(j.log_tail || [])
        if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') {
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
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  const refreshWorkflows = () => api('/api/workflows').then(setWorkflows).catch(() => {})
  const refreshGallery = () => api('/api/outputs').then(setGallery).catch(() => {})

  const onConnect = useCallback((c) => setEdges((es) => addEdge({
    ...c, type: 'smoothstep', animated: false,
    style: { stroke: '#7c8aa5', strokeWidth: 2 },
  }, es)), [setEdges])

  const addNode = (type) => {
    const pos = { x: 220 + Math.random() * 220, y: 120 + Math.random() * 260 }
    const data = type === 'model' ? { preset: 'flux2-4b' }
      : type === 'sampler' ? { width: 1024, height: 1024, steps: 4, cfg: 1, seed: 42, batch: 1, sampler: 'euler', strength: 0.6 }
      : type === 'upscale' ? { model: config.upscalers[0], repeats: 1 }
      : type === 'prompt' ? { positive: '' }
      : {}
    setNodes((ns) => [...ns, { id: uid(), type, position: pos, data }])
  }

  const graph = () => ({
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
      setJob(j); setLogs([]); setJobId(j.id)
    } catch (e) { setError(String(e)) }
  }

  const cancel = async () => {
    if (job?.id) {
      await api(`/api/jobs/${job.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
    }
  }

  const saveWorkflow = async () => {
    const n = window.prompt('Workflow name', name)?.trim()
    if (!n) return
    await api(`/api/workflows/${encodeURIComponent(n)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graph()),
    }).then(() => { setName(n); refreshWorkflows() }).catch((e) => setError(String(e)))
  }

  const loadWorkflow = async (n) => {
    try {
      const g = await api(`/api/workflows/${encodeURIComponent(n)}`)
      setNodes(g.nodes || []); setEdges(g.edges || []); setName(n)
    } catch (e) { setError(String(e)) }
  }

  const applyTemplate = (t) => {
    const g = templates[t]()
    setNodes(g.nodes); setEdges(g.edges); setName(t)
  }

  const outputs = job?.outputs || []

  return (
    <ConfigCtx.Provider value={config}>
      <div className="app">
        <header className="topbar">
          <div className="brand">Cloud_UI <span>sd.cpp node editor</span></div>
          <input className="wfname" value={name} onChange={(e) => setName(e.target.value)} />
          <button onClick={run} disabled={!!jobId} className="primary">
            {jobId ? 'Running…' : '▶ Run'}
          </button>
          <button onClick={cancel} disabled={!jobId}>■ Stop</button>
          <button onClick={saveWorkflow}>Save</button>
          <select className="wfsel" value="" onChange={(e) => e.target.value && loadWorkflow(e.target.value)}>
            <option value="">Load workflow…</option>
            {workflows.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
          </select>
          <button onClick={() => setShowGallery(!showGallery)}>Gallery</button>
          <div className="status">
            {job ? `${job.status} ${job.progress_text || ''}` : 'idle'}
            {job && <div className="bar"><i style={{ width: `${(job.progress || 0) * 100}%` }} /></div>}
          </div>
        </header>

        <aside className="palette">
          <div className="ptitle">Nodes</div>
          {[
            ['model', 'Model'], ['prompt', 'Prompt'], ['sampler', 'Sampler'],
            ['load_image', 'Load Image'], ['upscale', 'Upscale'], ['save', 'Save'],
          ].map(([t, label]) => (
            <button key={t} onClick={() => addNode(t)}>+ {label}</button>
          ))}
          <div className="ptitle">Templates</div>
          <button onClick={() => applyTemplate('txt2img')}>Txt2Img (fast)</button>
          <button onClick={() => applyTemplate('quality')}>Txt2Img (FLUX.3)</button>
          <button onClick={() => applyTemplate('edit')}>Edit (reference)</button>
          <button onClick={() => applyTemplate('upscale')}>Upscale</button>
          {error && <div className="error">{error}</div>}
        </aside>

        <main className="canvas">
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} fitView minZoom={0.15} maxZoom={2}
            defaultEdgeOptions={{ type: 'smoothstep' }}
          >
            <Background color="#2a3242" gap={24} />
            <MiniMap pannable zoomable nodeColor="#39435a" maskColor="#0b0f16cc" />
            <Controls />
          </ReactFlow>
        </main>

        <aside className={`side ${showGallery ? 'wide' : ''}`}>
          {showGallery ? (
            <>
              <div className="ptitle">Gallery <button className="link" onClick={refreshGallery}>↻</button></div>
              <div className="gallery">
                {gallery.map((f) => {
                  const url = `/files/${f.path.split('/').map(encodeURIComponent).join('/')}`
                  const isVideo = /\.(mp4|webm)$/i.test(f.path)
                  return (
                    <a key={f.path} href={url} target="_blank" rel="noreferrer" title={f.path}>
                      {isVideo ? <video src={url} muted /> : <img src={url} alt={f.path} />}
                    </a>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <div className="ptitle">Job</div>
              <div className="jobmeta">
                {job ? <><b>{job.status}</b> · {job.progress_text || '—'}</> : 'no job yet'}
              </div>
              <div className="outputs">
                {outputs.map((o) => {
                  const url = `/files/${o.split('/').map(encodeURIComponent).join('/')}`
                  const isVideo = /\.(mp4|webm)$/i.test(o)
                  return isVideo
                    ? <video key={o} src={url} controls />
                    : <img key={o} src={url} alt={o} />
                })}
              </div>
              <div className="ptitle">Log</div>
              <pre className="log" ref={logRef}>{logs.join('\n')}</pre>
            </>
          )}
        </aside>
      </div>
    </ConfigCtx.Provider>
  )
}
