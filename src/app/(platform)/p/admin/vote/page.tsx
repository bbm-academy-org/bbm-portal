import { redirect } from 'next/navigation'

/** `/p/admin/vote` is the section; its one resource is the poll list. */
export default function VoteSectionPage() {
  redirect('/p/admin/vote/polls')
}
