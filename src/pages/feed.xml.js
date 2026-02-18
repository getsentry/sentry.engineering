import rss from "@astrojs/rss";
import { getAllPosts } from "../lib/content.js";
import siteMetadata from "../data/siteMetadata.js";

export async function GET() {
  const posts = await getAllPosts();
  return rss({
    title: siteMetadata.title,
    description: siteMetadata.description,
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
