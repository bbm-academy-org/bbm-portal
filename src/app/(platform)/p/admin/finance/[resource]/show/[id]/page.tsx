import { notFound } from 'next/navigation'

import { isFinanceReferenceResource } from '@/lib/finance'

import { FinanceReferenceRecordScreen } from '../../../FinanceReferenceScreens'

export default async function ShowFinanceReferencePage({
  params,
}: {
  params: Promise<{ resource: string; id: string }>
}) {
  const { resource, id } = await params
  if (!isFinanceReferenceResource(resource) || !id.trim()) notFound()
  return <FinanceReferenceRecordScreen resource={resource} id={id} mode="show" />
}
