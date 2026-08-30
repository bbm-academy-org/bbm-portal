import { notFound } from 'next/navigation'

import { isFinanceReferenceResource } from '@/lib/finance'

import { FinanceReferenceListScreen } from '../FinanceReferenceListScreen'

export default async function FinanceReferencePage({
  params,
}: {
  params: Promise<{ resource: string }>
}) {
  const { resource } = await params
  if (!isFinanceReferenceResource(resource)) notFound()
  return <FinanceReferenceListScreen resource={resource} />
}
