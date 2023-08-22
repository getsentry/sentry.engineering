import Link from '@/components/Link'
import { PageSEO } from '@/components/SEO'
import Tag from '@/components/Tag'
import Image from 'next/image'
import siteMetadata from '@/data/siteMetadata'
//import { getAllFilesFrontMatter  } from '@/lib/mdx'
import { getAllFilesFrontMatter } from '@/lib/mdx'
import formatDate from '@/lib/utils/formatDate'

import NewsletterForm from '@/components/NewsletterForm'

const MAX_DISPLAY = 10

function trimString(string, length = 400) {
  return string.length > length ? string.substring(0, length - 3) + '...' : string
}

export async function getStaticProps() {
  const posts = await getAllFilesFrontMatter('blog')
  const authorDetails = await getAllFilesFrontMatter('authors')

  return { props: { posts, authorDetails } }
}

export default function Home({ posts, authorDetails }) {
  return (
    <>
      <PageSEO title={siteMetadata.title} description={siteMetadata.description} />
      <div className="divide-y divide-gray-200 border-none dark:divide-gray-700">
        <div className="space-y-2 pb-8 pt-6 md:space-y-5">
          <h1 className="text-3xl font-extrabold leading-9 tracking-tight text-gray-900 dark:text-gray-100 sm:text-4xl sm:leading-10 md:text-6xl md:leading-14">
            Latest
          </h1>
          <p className="text-lg leading-7 text-gray-500 dark:text-gray-400">
            {siteMetadata.description}
          </p>
        </div>

        {!posts.length && 'No posts found.'}
        <div className="grid border-none lg:grid-cols-3">
          {posts.slice(0, 3).map((frontMatter) => {
            const { slug, date, title, summary, tags, authors, images } = frontMatter
            let postAuthors = authorDetails.filter((author) => authors.includes(author.slug))
            return (
              <div key={slug} className="mr-8 max-w-sm overflow-hidden rounded shadow-lg">
                <Link href={`/blog/${slug}`} className="text-gray-900 dark:text-gray-100">
                  <Image
                    className="h-32 w-full"
                    priority={true}
                    height={1550}
                    width={640}
                    src={images[0]}
                    alt="Post hero image"
                  />
                </Link>
                <div className="px-6 py-4">
                  <div className="mb-2 text-xl font-bold">
                    <Link href={`/blog/${slug}`} className="text-gray-900 dark:text-gray-100">
                      {title}
                    </Link>
                  </div>
                  <p className="text-base text-gray-500 dark:text-gray-400">
                    {trimString(summary)}&nbsp;
                    <Link
                      href={`/blog/${slug}`}
                      className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
                      aria-label={`Read "${title}"`}
                    >
                      Read more &rarr;
                    </Link>
                  </p>
                </div>
                <div className="px-6 pb-2 pt-4">
                  {postAuthors.map((author) => {
                    return (
                      <li className="flex items-center space-x-2" key={author.name}>
                        {author.avatar && (
                          <Image
                            src={author.avatar}
                            width="38"
                            height="38"
                            alt="avatar"
                            className="h-10 w-10 rounded-full"
                          />
                        )}
                        <dl className="whitespace-nowrap text-sm font-medium leading-5">
                          <dt className="sr-only">Name</dt>
                          <dd className="text-gray-900 dark:text-gray-100">
                            <Link
                              className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
                              href={`/about/${encodeURIComponent(author.slug)}`}
                            >
                              {author.name}
                            </Link>
                          </dd>
                          <dt className="sr-only">Twitter</dt>
                          <dd>
                            {author.twitter && (
                              <Link
                                href={author.twitter}
                                className="text-xs text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
                              >
                                {author.twitter.replace('https://twitter.com/', '@')}
                              </Link>
                            )}
                          </dd>
                        </dl>
                      </li>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <ul className="divide-y divide-gray-200 border-none dark:divide-gray-700">
          {posts.slice(3, MAX_DISPLAY).map((frontMatter) => {
            const { slug, date, title, summary, tags } = frontMatter
            return (
              <li key={slug} className="py-12">
                <article>
                  <div className="space-y-2 xl:grid xl:grid-cols-4 xl:items-baseline xl:space-y-0">
                    <dl>
                      <dt className="sr-only">Published on</dt>
                      <dd className="text-base font-medium leading-6 text-gray-500 dark:text-gray-400">
                        <time dateTime={date}>{formatDate(date)}</time>
                      </dd>
                    </dl>
                    <div className="space-y-5 xl:col-span-3">
                      <div className="space-y-6">
                        <div>
                          <h2 className="text-2xl font-bold leading-8 tracking-tight">
                            <Link
                              href={`/blog/${slug}`}
                              className="text-gray-900 dark:text-gray-100"
                            >
                              {title}
                            </Link>
                          </h2>
                          <div className="flex flex-wrap">
                            {tags.map((tag) => (
                              <Tag key={tag} text={tag} />
                            ))}
                          </div>
                        </div>
                        <div className="prose max-w-none text-gray-500 dark:text-gray-400">
                          {summary}
                        </div>
                      </div>
                      <div className="text-base font-medium leading-6">
                        <Link
                          href={`/blog/${slug}`}
                          className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
                          aria-label={`Read "${title}"`}
                        >
                          Read more &rarr;
                        </Link>
                      </div>
                    </div>
                  </div>
                </article>
              </li>
            )
          })}
        </ul>
      </div>
      {posts.length > MAX_DISPLAY && (
        <div className="flex justify-end text-base font-medium leading-6">
          <Link
            href="/blog/page/2"
            className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
            aria-label="all posts"
          >
            Next Page &rarr;
          </Link>
        </div>
      )}
      {siteMetadata.newsletter.provider !== '' && (
        <div className="flex items-center justify-center pt-4">
          <NewsletterForm />
        </div>
      )}
    </>
  )
}
