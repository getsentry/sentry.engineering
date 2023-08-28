import { MDXLayoutRenderer } from '@/components/MDXComponents'
import { getFileBySlug } from '@/lib/mdx'
import { getPostsByAuthor } from '@/lib/mdx'
import { getAllAuthors } from '@/lib/mdx'

export async function getStaticProps(context) {
  let authorDetails = await getFileBySlug('authors', [context.params.slug])
  const posts = await getPostsByAuthor(context.params.slug)
  authorDetails.posts = posts
  return { props: { authorDetails } }
}

export async function getStaticPaths() {
  const authors = await getAllAuthors('blog')

  var paths = []
  for (let author in authors) {
    paths.push({
      params: { slug: author },
    })
  }

  return {
    paths,
    fallback: false,
  }
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
