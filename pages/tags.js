import Link from '@/components/Link'
import { PageSEO } from '@/components/SEO'
import Tag from '@/components/Tag'
import siteMetadata from '@/data/siteMetadata'
import { getAllTags } from '@/lib/tags'
import { getAllAuthors } from '@/lib/mdx'
import kebabCase from '@/lib/utils/kebabCase'

export async function getStaticProps() {
  const tags = await getAllTags('blog')
  const authors = await getAllAuthors('blog')

  return { props: { tags, authors } }
}

export default function Tags({ tags, authors }) {
  const sortedTags = Object.keys(tags).sort((a, b) => tags[b] - tags[a])
  const sortedAuthors = Object.keys(authors).sort(
    (a, b) => authors[b]['count'] - authors[a]['count']
  )

  return (
    <>
      <PageSEO title={`Tags - ${siteMetadata.author}`} description="Things I blog about" />
      <div className="flex flex-col items-start justify-start divide-y divide-gray-200 dark:divide-gray-700 md:mt-12 md:flex-row md:items-center md:justify-center md:space-x-6 md:divide-y-0">
        <div className="space-x-2 pb-8 pt-6 md:space-y-5">
          <h1 className="w-72 text-3xl font-extrabold leading-9 tracking-tight text-gray-900 dark:text-gray-100 sm:text-4xl sm:leading-10 md:border-r-2 md:px-6 md:text-6xl md:leading-14">
            Tags
          </h1>
        </div>
        <div className="flex max-w-lg flex-wrap">
          {Object.keys(tags).length === 0 && 'No tags found.'}
          {sortedTags.map((t) => {
            return (
              <div key={t} className="mb-2 mr-5 mt-2">
                <Tag text={t} />
                <Link
                  href={`/tags/${kebabCase(t)}`}
                  className="-ml-2 text-sm font-semibold uppercase text-gray-600 dark:text-gray-300"
                >
                  {` (${tags[t]})`}
                </Link>
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex flex-col items-start justify-start divide-y divide-gray-200 dark:divide-gray-700 md:mt-12 md:flex-row md:items-center md:justify-center md:space-x-6 md:divide-y-0">
        <div className="space-x-2 pb-8 pt-6 md:space-y-5">
          <h1 className="w-72 text-3xl font-extrabold leading-9 tracking-tight text-gray-900 dark:text-gray-100 sm:text-4xl sm:leading-10 md:border-r-2 md:px-6 md:text-6xl md:leading-14">
            Authors
          </h1>
        </div>
        <div className="flex max-w-lg flex-wrap">
          {Object.keys(authors).length === 0 && 'No authors found.'}
          {sortedAuthors.map((t) => {
            return (
              <div key={t} className="mb-2 mr-5 mt-2">
                <Link
                  href={`/about/${t}`}
                  className="mr-3 text-sm font-medium uppercase text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
                >
                  {authors[t]['name']}
                </Link>
                <Link
                  href={`/about/${t}`}
                  className="-ml-2 text-sm font-semibold uppercase text-gray-600 dark:text-gray-300"
                >
                  {` (${authors[t]['count']})`}
                </Link>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
