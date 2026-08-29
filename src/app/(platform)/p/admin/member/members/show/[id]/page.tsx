import { notFound } from 'next/navigation'

import { MemberRecordScreen } from '../../MemberRecordScreen'

export default async function ShowMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isSafeInteger(id) || id <= 0) notFound()
  return <MemberRecordScreen id={id} mode="show" />
}
