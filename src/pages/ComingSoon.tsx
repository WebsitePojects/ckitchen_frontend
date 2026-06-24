import type { LucideIcon } from 'lucide-react'
import { Construction } from 'lucide-react'
import PageHeader from '../components/common/PageHeader'
import EmptyState from '../components/common/EmptyState'
import { usePageHeader } from '../components/layout/PageHeaderContext'

interface ComingSoonProps {
  title: string
  subtitle?: string
  icon?: LucideIcon
}

/** Styled stub for routes whose reskin hasn't landed yet. */
export default function ComingSoon({ title, subtitle, icon }: ComingSoonProps) {
  usePageHeader(title, subtitle)

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState
        icon={icon ?? Construction}
        title="Coming soon"
        description={`${title} is being built. Check back shortly.`}
      />
    </div>
  )
}
