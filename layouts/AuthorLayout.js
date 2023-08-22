import SocialIcon from '@/components/social-icons'
import Image from 'next/image'
import { PageSEO } from '@/components/SEO'
import formatDate from '@/lib/utils/formatDate'
import Link from '@/components/Link'

export default function AuthorLayout({ children, frontMatter, posts }) {
  const { name, avatar, occupation, url, company, email, twitter, linkedin, github } = frontMatter

  return (
    <>
      <PageSEO title={`About - ${name}`} description={`About me - ${name}`} />
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        <div className="items-start space-y-2 xl:grid xl:grid-cols-3 xl:gap-x-8 xl:space-y-0">
          <div className="flex flex-col items-center pt-8">
            <Image
              src={avatar}
              alt="avatar"
              width="192"
              height="192"
              className="h-48 w-48 rounded-full"
            />
            <h1 className="pb-2 pt-4 text-4xl font-bold leading-8 tracking-tight">{name}</h1>
            <div className="text-gray-500 dark:text-gray-400">{occupation}</div>
            <div className="flex space-x-3 pt-6">
              <SocialIcon kind="github" href={github} />
              <SocialIcon kind="linkedin" href={linkedin} />
              <SocialIcon kind="twitter" href={twitter} />
              <SocialIcon kind="link" href={url} />
            </div>
          </div>
          <div className="xl:col-span-2">
            <h2 className="mb-2 text-4xl font-bold">About</h2>
            <div className="prose pb-8">{children}</div>
            {posts.length > 0 && (
              <div>
                <h2 className="mb-2 text-4xl font-bold">Posts</h2>
                {posts.map((frontMatter) => {
                  const { slug, date, title, summary, tags } = frontMatter
                  return (
                    <article key={slug}>
                      <div className="space-y-2 pb-8 xl:grid xl:grid-cols-4 xl:items-baseline xl:space-y-0">
                        <div className="space-y-5 xl:col-span-3">
                          <div className="space-y-6">
                            <div>
                              <h3 className="text-2xl font-bold leading-8 tracking-tight">
                                <Link
                                  href={`/blog/${slug}`}
                                  className="text-gray-900 dark:text-gray-100"
                                >
                                  {title}
                                </Link>
                              </h3>
                              <time
                                className="font-xs text-gray-500 dark:text-gray-400"
                                dateTime={date}
                              >
                                {formatDate(date)}
                              </time>
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
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
