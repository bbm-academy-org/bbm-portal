'use client'

import '@xyflow/react/dist/style.css'
import './viewer.css'

import dynamic from 'next/dynamic'
import React from 'react'

import type { Idef0Model } from '@/lib/processes'

/**
 * The client shell of the IDEF0 viewer — bbm-kb `components/idef0-viewer/
 * client.tsx`, ported (#553). `viewer.mjs` is a browser module (it measures
 * text through a canvas when it loads and reads location/localStorage), so it
 * is loaded in the browser only: `next/dynamic` with `ssr: false`. The model
 * arrives from the server page, read per request from bbm-kb main.
 */
const Viewer = dynamic(() => import('./viewer.mjs'), {
  ssr: false,
  loading: () => <p style={{ padding: 16 }}>Загрузка модели…</p>,
})

export function Idef0ViewerClient({ model }: { model: Idef0Model }) {
  return (
    <div className="idef0-viewer not-prose">
      <Viewer model={model} />
    </div>
  )
}
