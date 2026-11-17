'use client';
// Клиентская оболочка просмотрщика IDEF0. viewer.mjs — браузерный модуль (меряет текст через
// canvas при загрузке, читает location/localStorage), поэтому грузится только в браузере:
// next/dynamic с ssr: false. Библиотеки (@xyflow/react, htm) — из npm, собираются в сайт; CDN нет.
import dynamic from 'next/dynamic';
import '@xyflow/react/dist/style.css';
import './viewer.css';
import type { Idef0Model } from './index';

const Viewer = dynamic(() => import('./viewer.mjs'), {
  ssr: false,
  loading: () => <p style={{ padding: 16 }}>Загрузка модели…</p>,
});

export function Idef0ViewerClient({ model }: { model: Idef0Model }) {
  return (
    <div className="idef0-viewer not-prose">
      <Viewer model={model} />
    </div>
  );
}
