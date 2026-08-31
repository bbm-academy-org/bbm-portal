import { notFound } from 'next/navigation'

import { isFinanceReferenceResource } from '@/lib/finance'

import { FinanceReferenceCreateScreen } from '../../FinanceReferenceScreens'

export default async function CreateFinanceReferencePage({
  params,
}: {
  params: Promise<{ resource: string }>
}) {
  const { resource } = await params
  if (!isFinanceReferenceResource(resource)) notFound()
  return <FinanceReferenceCreateScreen resource={resource} />
}
