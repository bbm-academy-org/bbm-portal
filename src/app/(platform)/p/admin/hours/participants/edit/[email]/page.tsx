import { notFound } from 'next/navigation'

import { HoursParticipantRecordScreen } from '../../HoursParticipantRecordScreen'

export default async function EditHoursParticipantPage({
  params,
}: {
  params: Promise<{ email: string }>
}) {
  const email = decodeURIComponent((await params).email).trim()
  if (!email) notFound()
  return <HoursParticipantRecordScreen email={email} />
}
