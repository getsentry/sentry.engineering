import * as React from "react"
import { Link, graphql } from "gatsby"

import Layout from "../components/layout"
import Seo from "../components/seo"

const SyndicatedPostTemplate = ({ data, location }) => {
  console.log(data)
  const { previous, next, site, feedVanguard: post } = data
  const siteTitle = site.siteMetadata?.title || `Title`

  return (
    <Layout location={location} title={siteTitle}>
      <article
        className="blog-post"
        itemScope
        itemType="http://schema.org/Article"
      >
        <header>
          <h1 itemProp="headline">{post.title}</h1>
          <p>
            {post.author} / {post.pubDate}
          </p>
        </header>
        <section
          dangerouslySetInnerHTML={{ __html: post.content.encoded }}
          itemProp="articleBody"
        />
        <hr />
        <footer></footer>
      </article>
      <nav className="blog-post-nav">
        <ul
          style={{
            display: `flex`,
            flexWrap: `wrap`,
            justifyContent: `space-between`,
            listStyle: `none`,
            padding: 0,
          }}
        >
          <li>
            {previous && (
              <Link to={previous.fields.slug} rel="prev">
                ← {previous.title}
              </Link>
            )}
          </li>
          <li>
            {next && (
              <Link to={next.fields.slug} rel="next">
                {next.title} →
              </Link>
            )}
          </li>
        </ul>
      </nav>
    </Layout>
  )
}

export const Head = ({ data: { feedVanguard: post } }) => {
  return <Seo title={post.title} description={post.description} />
}

export default SyndicatedPostTemplate

export const pageQuery = graphql`
  query FeedVanguardPostBySlug(
    $id: String!
    $previousPostId: String
    $nextPostId: String
  ) {
    site {
      siteMetadata {
        title
      }
    }
    feedVanguard(id: { eq: $id }) {
      id
      content {
        encoded
      }
      author
      description
      title
      pubDate
    }
    previous: feedVanguard(id: { eq: $previousPostId }) {
      fields {
        slug
      }
      title
    }
    next: feedVanguard(id: { eq: $nextPostId }) {
      fields {
        slug
      }
      title
    }
  }
`
