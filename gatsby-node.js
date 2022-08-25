const path = require(`path`)
const { createFilePath } = require(`gatsby-source-filesystem`)

exports.createPages = async ({ graphql, actions, reporter }) => {
  const { createPage } = actions

  // Define a template for blog post
  const blogPost = path.resolve(`./src/templates/blog-post.js`)

  const createPagesFromContent = async () => {
    // Get all markdown blog posts sorted by date
    const result = await graphql(
      `
        {
          allMarkdownRemark(
            sort: { fields: [frontmatter___date], order: ASC }
            limit: 1000
          ) {
            nodes {
              id
              frontmatter {
                title
                date
                description
              }
              fields {
                slug
              }
            }
          }
        }
      `
    )

    if (result.errors) {
      reporter.panicOnBuild(
        `There was an error loading your blog posts`,
        result.errors
      )
      return
    }

    const posts = result.data.allMarkdownRemark.nodes

    // Create blog posts pages
    // But only if there's at least one markdown file found at "content/blog" (defined in gatsby-config.js)
    // `context` is available in the template as a prop and as a variable in GraphQL

    if (posts.length > 0) {
      posts.forEach((post, index) => {
        const previousPostId = index === 0 ? null : posts[index - 1].id
        const nextPostId =
          index === posts.length - 1 ? null : posts[index + 1].id

        createPage({
          path: post.fields.slug,
          component: blogPost,
          context: {
            id: post.id,
            previousPostId,
            nextPostId,
            title: post.frontmatter.title,
            description: node.frontmatter.description,
            date: node.frontmatter.date,
          },
        })
      })
    }
  }

  const createPagesFromVanguard = async () => {
    const result = await graphql(
      `
        {
          allFeedVanguard {
            edges {
              node {
                title
                pubDate
                description
                fields {
                  slug
                }
              }
            }
          }
        }
      `
    )

    if (result.errors) {
      reporter.panicOnBuild(
        `There was an error loading your blog posts`,
        result.errors
      )
      return
    }

    const posts = result.data.allFeedVanguard.edges

    // Create blog posts pages
    // But only if there's at least one markdown file found at "content/blog" (defined in gatsby-config.js)
    // `context` is available in the template as a prop and as a variable in GraphQL

    if (posts.length > 0) {
      posts.forEach(({ node }, index) => {
        const previousPostId = index === 0 ? null : posts[index - 1].id
        const nextPostId =
          index === posts.length - 1 ? null : posts[index + 1].id

        createPage({
          path: node.fields.slug,
          component: blogPost,
          context: {
            id: node.id,
            previousPostId,
            nextPostId,
            title: node.title,
            description: node.description,
            date: node.pubDate,
          },
        })
      })
    }
  }

  await createPagesFromContent()
  await createPagesFromVanguard()
}

exports.onCreateNode = ({ node, actions, getNode }) => {
  const { createNodeField } = actions

  if (node.internal.type === "FeedVanguard") {
    createNodeField({
      node,
      name: "slug",
      value: node.link.split("http://localhost:3000/")[1],
    })
  } else if (node.internal.type === `MarkdownRemark`) {
    const value = createFilePath({ node, getNode })

    createNodeField({
      name: `slug`,
      node,
      value,
    })
  }
}

exports.createSchemaCustomization = ({ actions }) => {
  const { createTypes } = actions

  // Explicitly define the siteMetadata {} object
  // This way those will always be defined even if removed from gatsby-config.js

  // Also explicitly define the Markdown frontmatter
  // This way the "MarkdownRemark" queries will return `null` even when no
  // blog posts are stored inside "content/blog" instead of returning an error
  createTypes(`
    type SiteSiteMetadata {
      author: Author
      siteUrl: String
      social: Social
    }

    type Author {
      name: String
      summary: String
    }

    type Social {
      twitter: String
    }

    type MarkdownRemark implements Node {
      frontmatter: Frontmatter
      fields: Fields
    }

    type Frontmatter {
      title: String
      description: String
      date: Date @dateformat
    }

    type Fields {
      slug: String
    }
  `)
}
