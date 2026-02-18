import rss from "@astrojs/rss";
import { getAllTags, getPostsByTag } from "../../../lib/content.js";
import siteMetadata from "../../../data/siteMetadata.js";

export async function getStaticPaths() {
  const allTags = await getAllTags();
  return Object.keys(allTags).map((tag) => ({
    params: { tag },
  }));
}

export async function GET({ params }) {
  const posts = await getPostsByTag(params.tag);
  const tag = params.tag;

  return rss({
    title: `${tag} - ${siteMetadata.title}`,
    description: `${tag} posts`,
    site: siteMetadata.siteUrl,
    trailingSlash: false,
    customData: [
      `<language>${siteMetadata.language}</language>`,
      `<managingEditor>${siteMetadata.email} (${siteMetadata.author})</managingEditor>`,
      `<webMaster>${siteMetadata.email} (${siteMetadata.author})</webMaster>`,
    ].join(""),
    items: posts.map((post) => ({
      title: post.title,
      description: post.summary ?? "",
      link: `/blog/${post.slug}`,
      pubDate: post.date ? new Date(post.date) : undefined,
      categories: Array.isArray(post.tags) ? post.tags : [],
      author: siteMetadata.email,
    })),
  });
}
