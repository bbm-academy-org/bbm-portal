import { notFound } from 'next/navigation'

import { HoursPeriodRecordScreen } from '../../HoursPeriodRecordScreen'

export default async function EditHoursPeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.trim()
  if (!id) notFound()
  return <HoursPeriodRecordScreen id={id} />
}
