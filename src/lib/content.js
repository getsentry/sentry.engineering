import { getCollection, getEntry } from "astro:content";
import { toTagSlug } from "./utils.js";

function dateSortDesc(a, b) {
  const aTime = a ? new Date(a).getTime() : 0;
  const bTime = b ? new Date(b).getTime() : 0;
  return bTime - aTime;
}

async function loadBlogCollection() {
  const entries = await getCollection("blog", ({ data }) => data.draft !== true);
  return entries
    .map((entry) => toPostRecord(entry))
    .sort((a, b) => dateSortDesc(a.date, b.date));
}

async function loadAuthorsCollection() {
  const entries = await getCollection("authors");
  return entries
    .map((entry) => toAuthorRecord(entry))
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

function toPostRecord(entry) {
  const authors = Array.isArray(entry.data.authors)
    ? entry.data.authors.map((author) =>
        typeof author === "string" ? author : author.id,
      )
    : [];

  return {
    entry,
    ...entry.data,
    id: entry.id,
    slug: entry.slug,
    authors,
    date:
      entry.data.date instanceof Date
        ? entry.data.date.toISOString()
        : null,
    lastmod:
      entry.data.lastmod instanceof Date
        ? entry.data.lastmod.toISOString()
        : null,
  };
}

function toAuthorRecord(entry) {
  return {
    entry,
    ...entry.data,
    id: entry.id,
    slug: entry.slug,
  };
}

export async function getAllPosts() {
  return loadBlogCollection();
}

export async function getPostBySlug(slug) {
  const entry = await getEntry("blog", slug);
  if (!entry || entry.data?.draft === true) {
    return null;
  }
  return toPostRecord(entry);
}

export async function getAllAuthors() {
  return loadAuthorsCollection();
}

export async function getAuthorBySlug(slug) {
  const entry = await getEntry("authors", slug);
  if (!entry) {
    return null;
  }
  return toAuthorRecord(entry);
}

export async function getPostsByAuthor(authorSlug) {
  const posts = await getAllPosts();
  return posts.filter((post) => {
    const authors = Array.isArray(post.authors) ? post.authors : [];
    return authors.includes(authorSlug);
  });
}

export async function getAuthorCountsFromPosts() {
  const authorCounts = {};
  const posts = await getAllPosts();
  const allAuthors = await getAllAuthors();
  const authorMap = new Map(allAuthors.map((author) => [author.slug, author]));

  for (const post of posts) {
    const authors =
      Array.isArray(post.authors) && post.authors.length > 0 ? post.authors : ["default"];

    for (const authorSlug of authors) {
      if (!authorCounts[authorSlug]) {
        const author = authorMap.get(authorSlug);
        authorCounts[authorSlug] = {
          count: 0,
          name: author?.name ?? authorSlug,
        };
      }

      authorCounts[authorSlug].count += 1;
    }
  }

  return authorCounts;
}

export async function getAllTags() {
  const tags = {};
  const posts = await getAllPosts();

  for (const post of posts) {
    const postTags = Array.isArray(post.tags) ? post.tags : [];
    for (const tag of postTags) {
      const tagSlug = toTagSlug(tag);
      tags[tagSlug] = (tags[tagSlug] ?? 0) + 1;
    }
  }

  return tags;
}

export async function getPostsByTag(tagSlug) {
  const posts = await getAllPosts();
  return posts.filter((post) => {
    const postTags = Array.isArray(post.tags) ? post.tags : [];
    return postTags.some((tag) => toTagSlug(tag) === tagSlug);
  });
}
