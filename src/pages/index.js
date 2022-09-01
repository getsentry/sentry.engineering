import * as React from "react"
import { Link, graphql } from "gatsby"

import Layout from "../components/layout"
import Seo from "../components/seo"

const BlogIndex = ({ data, location }) => {
  const siteTitle = data.site.siteMetadata?.title || `Title`
  const posts = data.allSitePage.edges

  if (posts.length === 0) {
    return (
      <Layout location={location} title={siteTitle}>
        <p>Oops. Nothing to see here!</p>
      </Layout>
    )
  }

  return (
    <Layout location={location} title={siteTitle}>
      <ol class="post-list">
        {posts.map(({ node }) => {
          const title = node.pageContext.title

          return (
            <li className="post-list-item" key={node.path}>
              <article itemScope itemType="http://schema.org/Article">
                <Link to={node.path} itemProp="url">
                  <header>
                    <h2>
                      <span itemProp="headline">{title}</span>
                    </h2>
                    <small>{node.pageContext.date}</small>
                  </header>
                  <section>
                    <p
                      dangerouslySetInnerHTML={{
                        __html: node.pageContext.description,
                      }}
                      itemProp="description"
                    />
                  </section>
                </Link>
              </article>
            </li>
          )
        })}
      </ol>
    </Layout>
  )
}

export default BlogIndex

/**
 * Head export to define metadata for the page
 *
 * See: https://www.gatsbyjs.com/docs/reference/built-in-components/gatsby-head/
 */
export const Head = () => <Seo title="All posts" />

export const pageQuery = graphql`
  query {
    site {
      siteMetadata {
        title
      }
    }

    allSitePage(
      filter: {
        internal: {}
        pluginCreator: { name: { eq: "default-site-plugin" } }
      }
    ) {
      edges {
        node {
          path
          pageContext
        }
      }
    }
  }
`
