import { MDXLayoutRenderer } from '@/components/MDXComponents'
import { getFileBySlug } from '@/lib/mdx'
import { getPostsByAuthor } from '@/lib/mdx'

export async function getServerSideProps(context) {
  let authorDetails = await getFileBySlug('authors', [context.params.slug])
  const posts = await getPostsByAuthor(context.params.slug)
  authorDetails.posts = posts
  return { props: { authorDetails } }
}

export default function About({ authorDetails }) {
  const { mdxSource, frontMatter, posts } = authorDetails
  return (
    <MDXLayoutRenderer
      layout="AuthorLayout"
      mdxSource={mdxSource}
      frontMatter={frontMatter}
      posts={posts}
    />
  )
}
