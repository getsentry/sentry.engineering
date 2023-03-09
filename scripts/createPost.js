// Allow engineers to create a new post with the proper frontmatter
const { string_to_slug } = require('../gatsby-node')
const dateFns = require('date-fns')
const fs = require('fs')

const title = process.argv[2]

if (!title) {
  throw 'a title is required!'
}

const slug = string_to_slug(title)
const date = dateFns.format(new Date(), 'yyyy-MM-dd')
const dir = `./content/blog/${slug}`

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir)
} else {
  throw 'That post already exists!'
}

fs.writeFileSync(
  `${dir}/index.mdx`,
  `---
slug: ${slug}
date: ${date}
title: "${title}"
description: ""
---`,
  function(err) {
    if (err) {
      return console.log(err)
    }

    console.log(`${title} was created!`)
  },
)