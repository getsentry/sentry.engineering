# Sentry Engineering Blog

## Installation / Development

```bash
npm install
```

First, run the development server:

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Write a new Post

### Compose

1. If this is your first time writing a post, make sure you add your authors.md file first.
2. Run `npm run write` to bootstrap a new post.

Follow the interactive prompt to generate a post with pre-filled front matter.

### Adding Images

When you use `npm run write` to boostrap a new post, a directory in `public/images/<postname>/` is also created. Add all of your images into that directory. To include your images in a post you can add the normal image markdown.

```markdown
![Meaningful Alt Text](/images/<postname>/<filename>.png)
```

If you need specific styling you can also use raw html in the markdown post.

### Frontmatter (Metadata)

Frontmatter follows [Hugo's standards](https://gohugo.io/content-management/front-matter/). The required fields are automatically added when you use `npm run write` to create a new post.

Currently 7 fields are supported.

```
title (required)
date (required)
tags (required, can be empty array)
lastmod (optional)
draft (optional)
summary (optional)
images (optional, if none provided defaults to socialBanner in siteMetadata config)
authors (optional list which should correspond to the file names in `data/authors`. Uses `default` if none is specified)
layout (optional list which should correspond to the file names in `data/layouts`)
canonicalUrl (optional, canonical url for the post for SEO)
```

Here's an example of a post's frontmatter:

```
---
title: 'Introducing Tailwind Nexjs Starter Blog'
date: '2021-01-12'
lastmod: '2021-01-18'
tags: ['next-js', 'tailwind', 'guide']
draft: false
summary: 'Looking for a performant, out of the box template, with all the best in web technology to support your blogging needs? Checkout the Tailwind Nextjs Starter Blog template.'
images: ['/static/images/canada/mountains.jpg', '/static/images/canada/toronto.jpg']
authors: ['default', 'sparrowhawk']
layout: PostLayout
canonicalUrl: https://tailwind-nextjs-starter-blog.vercel.app/blog/introducing-tailwind-nextjs-starter-blog
---
```

## Common Markdown Formatting

| Element | Syntax |
| ----------- | ----------- |
| Heading | # H1<br />## H2<br />### H3 |
| Bold | \*\*bold text** |
| Italic | \*italicized text* |
| Blockquote | > blockquote| 
| Ordered List | 1. First item<br />2. Second item<br />3. Third item |
| Unordered List | - First item<br />- Second item<br />- Third item |
| Code | \`code`|
| Code Block | \```\<language><br />code<br />```|
| Link | \[title][https://sentry.io]|
| Image | \![alt text][image.jpg] |

## Extend / Customize

When writing a post you'll only need to add your information to `data/authors/yourname.md` and modify the files created by `npm run write`. Everything beyond that is used to improve the general blog.

`data/authors/yourname.md` - author information (required).

`data/blog` - replace with your own blog posts.

`data/siteMetadata.js` - contains most of the site-related information which should be modified for a user's need.

`data/headerNavLinks.js` - navigation links.

`public/static` - store assets such as images and favicons.

`tailwind.config.js` and `css/tailwind.css` - contain the tailwind stylesheet which can be modified to change the overall look and feel of the site.

`css/prism.css` - controls the styles associated with the code blocks. Feel free to customize it and use your preferred prismjs theme e.g. [prism themes](https://github.com/PrismJS/prism-themes).

`components/social-icons` - to add other icons, simply copy an svg file from [Simple Icons](https://simpleicons.org/) and map them in `index.js`. Other icons use [heroicons](https://heroicons.com/).

`components/MDXComponents.js` - pass your own JSX code or React component by specifying it over here. You can then call them directly in the `.mdx` or `.md` file. By default, a custom link and image component is passed.

`layouts` - main templates used in pages.

`pages` - pages to route to. Read the [Next.js documentation](https://nextjs.org/docs) for more information.

`next.config.js` - configuration related to Next.js. You need to adapt the Content Security Policy if you want to load scripts, images etc. from other domains.


## Releasing a Post 

1. Write your amazing post
2. Commit your post and images directory
3. Create a PR
4. Ask for a review if you're concerned about your writing style/grammar/content/etc...
5. Release once you're ready


## Tailwind Nextjs Starter Blog
This blog is built off of the [Tailwind Nextjs Starter blog](https://github.com/timlrx/tailwind-nextjs-starter-blog/). You can check out more details of what's available over there.


## Licence

[MIT](https://github.com/timlrx/tailwind-nextjs-starter-blog/blob/master/LICENSE) © [Timothy Lin](https://www.timlrx.com)
