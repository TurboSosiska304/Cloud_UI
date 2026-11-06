import { useContext, useRef, useState } from 'react'
import { Handle, Position, useReactFlow } from '@xyflow/react'
import { ConfigCtx, api } from './state.js'

function Shell({ title, accent, children, inputs = [], outputs = [], width }) {
  return (
    <div className="node" style={{ '--accent': accent, minWidth: width || 220 }}>
      <div className="node-head">{title}</div>
      <div className="node-body">{children}</div>
      {inputs.map((h, i) => (
        <div key={h.id} className="portwrap" style={{ top: 32 + i * 21 }}>
          <Handle id={h.id} type="target" position={Position.Left} className="port" />
          <span className="portlabel in">{h.label || h.id}</span>
        </div>
      ))}
      {outputs.map((h, i) => (
        <div key={h.id} className="portwrap out" style={{ top: 32 + i * 21 }}>
          <Handle id={h.id} type="source" position={Position.Right} className="port" />
          <span className="portlabel out">{h.label || h.id}</span>
        </div>
      ))}
    </div>
  )
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

export function ModelNode({ id, data }) {
  const { models } = useContext(ConfigCtx)
  const { updateNodeData } = useReactFlow()
  const m = models[data.preset] || {}
  return (
    <Shell title="Model" accent="#6ea8fe" outputs={[{ id: 'model' }]}>
      <Field label="Diffusion model">
        <select value={data.preset || 'flux2-4b'}
          onChange={(e) => updateNodeData(id, { preset: e.target.value })}>
          {Object.entries(models).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </Field>
      <div className="hint">{m.family} · {m.steps} steps · cfg {m.cfg}</div>
      <div className="hint">TE/VAE подключаются отдельными нодами (иначе — дефолт пресета)</div>
    </Shell>
  )
}

export function TENode({ id, data }) {
  const { text_encoders } = useContext(ConfigCtx)
  const { updateNodeData } = useReactFlow()
  return (
    <Shell title="Text Encoder" accent="#82aaff" outputs={[{ id: 'te' }]}>
      <Field label="Encoder">
        <select value={data.file || 'qwen3-4b'}
          onChange={(e) => updateNodeData(id, { file: e.target.value })}>
          {Object.entries(text_encoders).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </Field>
      <div className="hint">подключи к Sampler → te</div>
    </Shell>
  )
}

export function VAENode({ id, data }) {
  const { vaes } = useContext(ConfigCtx)
  const { updateNodeData } = useReactFlow()
  return (
    <Shell title="VAE" accent="#82aaff" outputs={[{ id: 'vae' }]}>
      <Field label="VAE">
        <select value={data.file || 'flux2'}
          onChange={(e) => updateNodeData(id, { file: e.target.value })}>
          {Object.entries(vaes).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </Field>
      <div className="hint">подключи к Sampler → vae</div>
    </Shell>
  )
}

export function PromptNode({ id, data }) {
  const { updateNodeData } = useReactFlow()
  const [showNeg, setShowNeg] = useState(false)
  return (
    <Shell title="Prompt" accent="#c792ea" outputs={[{ id: 'prompt' }]}>
      <textarea rows={4} placeholder="positive prompt" value={data.positive || ''}
        onChange={(e) => updateNodeData(id, { positive: e.target.value })} />
      <button className="link" onClick={() => setShowNeg(!showNeg)}>
        {showNeg ? '− negative' : '+ negative'}
      </button>
      {showNeg && <textarea rows={3} placeholder="negative prompt" value={data.negative || ''}
        onChange={(e) => updateNodeData(id, { negative: e.target.value })} />}
    </Shell>
  )
}

function commonSamplerFields(data, set) {
  return (
    <>
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
    </>
  )
}

export function ImageSamplerNode({ id, data }) {
  const { updateNodeData } = useReactFlow()
  const set = (k, v) => updateNodeData(id, { [k]: v })
  return (
    <Shell title="Image Sampler" accent="#ffcb6b"
      inputs={[{ id: 'model' }, { id: 'prompt' }, { id: 'te' }, { id: 'vae' }]}
      outputs={[{ id: 'image' }]} width={240}>
      {commonSamplerFields(data, set)}
      <div className="hint">text-to-image, без референса</div>
    </Shell>
  )
}

export function ImageRefSamplerNode({ id, data }) {
  const { updateNodeData } = useReactFlow()
  const set = (k, v) => updateNodeData(id, { [k]: v })
  return (
    <Shell title="Image Sampler (ref)" accent="#ffcb6b"
      inputs={[{ id: 'model' }, { id: 'prompt' }, { id: 'image' }, { id: 'te' }, { id: 'vae' }]}
      outputs={[{ id: 'image' }]} width={240}>
      {commonSamplerFields(data, set)}
      <Field label="Ref strength (img2img)">
        <input type="number" step="0.05" min="0" max="1" value={data.strength ?? 0.6}
          onChange={(e) => set('strength', +e.target.value)} />
      </Field>
      <div className="hint">Flux: reference/edit · остальные: img2img</div>
    </Shell>
  )
}

export function WanSamplerNode({ id, data }) {
  const { updateNodeData } = useReactFlow()
  const set = (k, v) => updateNodeData(id, { [k]: v })
  return (
    <Shell title="Wan Sampler (video)" accent="#ffcb6b"
      inputs={[{ id: 'model' }, { id: 'prompt' }, { id: 'image' }, { id: 'te' }, { id: 'vae' }]}
      outputs={[{ id: 'image' }]} width={250}>
      <div className="row">
        <Field label="W"><input type="number" step="16" value={data.width ?? 640}
          onChange={(e) => set('width', +e.target.value)} /></Field>
        <Field label="H"><input type="number" step="16" value={data.height ?? 352}
          onChange={(e) => set('height', +e.target.value)} /></Field>
      </div>
      <div className="row">
        <Field label="Steps"><input type="number" min="1" max="60" value={data.steps ?? 20}
          onChange={(e) => set('steps', +e.target.value)} /></Field>
        <Field label="CFG"><input type="number" step="0.1" value={data.cfg ?? 6}
          onChange={(e) => set('cfg', +e.target.value)} /></Field>
      </div>
      <div className="row">
        <Field label="Frames"><input type="number" value={data.frames ?? 33}
          onChange={(e) => set('frames', +e.target.value)} /></Field>
        <Field label="FPS"><input type="number" value={data.fps ?? 16}
          onChange={(e) => set('fps', +e.target.value)} /></Field>
      </div>
      <div className="row">
        <Field label="Seed"><input type="number" value={data.seed ?? 42}
          onChange={(e) => set('seed', +e.target.value)} /></Field>
        <Field label="Flow shift"><input type="number" step="0.1" value={data.flow_shift ?? 3}
          onChange={(e) => set('flow_shift', +e.target.value)} /></Field>
      </div>
      <Field label="Sampler">
        <select value={data.sampler || 'euler'} onChange={(e) => set('sampler', e.target.value)}>
          <option>euler</option><option>heun</option><option>dpm++2m</option>
        </select>
      </Field>
      <div className="hint">image input → i2v (опционально)</div>
    </Shell>
  )
}

export function LoadImageNode({ id, data }) {
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
      <input className="path" placeholder="/path/to/image.png" value={data.path || ''}
        onChange={(e) => updateNodeData(id, { path: e.target.value })} />
      <button onClick={() => fileRef.current?.click()}>Upload…</button>
      <input ref={fileRef} type="file" accept="image/*" hidden
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      {src && <img className="thumb" src={src} alt="" />}
    </Shell>
  )
}

export function UpscaleNode({ id, data }) {
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

export function SaveNode({ id, data }) {
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

export const nodeTypes = {
  model: ModelNode,
  te: TENode,
  vae: VAENode,
  prompt: PromptNode,
  image_sampler: ImageSamplerNode,
  image_ref_sampler: ImageRefSamplerNode,
  wan_sampler: WanSamplerNode,
  load_image: LoadImageNode,
  upscale: UpscaleNode,
  save: SaveNode,
}

export const NODE_DEFAULTS = {
  model: { preset: 'flux2-4b' },
  te: { file: 'qwen3-4b' },
  vae: { file: 'flux2' },
  prompt: { positive: '' },
  image_sampler: { width: 1024, height: 1024, steps: 4, cfg: 1, seed: 42, batch: 1, sampler: 'euler' },
  image_ref_sampler: { width: 1024, height: 1024, steps: 4, cfg: 1, seed: 42, batch: 1, sampler: 'euler', strength: 0.6 },
  wan_sampler: { width: 640, height: 352, steps: 20, cfg: 6, seed: 42, frames: 33, fps: 16, flow_shift: 3, sampler: 'euler' },
  load_image: { path: '' },
  upscale: { model: 'RealESRGAN_x4plus', repeats: 1 },
  save: { name: '' },
}
